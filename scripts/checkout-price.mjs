/** Catalog prices for the checkout Worker. Ignore any unit/total the browser sends. */

export const QTY_MAX = 10;
export const LINE_MAX = 20;

/** One flat for a small tracked international parcel. Change this number only. */
export const INTERNATIONAL_SHIPPING_USD = 18;

const FREE_SHIP_COUNTRIES = new Set(["US", "PR", "GU", "VI", "AS", "MP", "UM"]);

export function shipCountry(code) {
  return String(code || "").trim().toUpperCase();
}

export function countryFromPaypal(details) {
  return shipCountry(details?.purchase_units?.[0]?.shipping?.address?.country_code);
}

export function shippingAmount(countryCode) {
  const code = shipCountry(countryCode);
  if (!code) throw new Error("Checkout failed.");
  return FREE_SHIP_COUNTRIES.has(code) ? 0 : INTERNATIONAL_SHIPPING_USD;
}

export function money(value) {
  return (Math.round(Number(value) * 100) / 100).toFixed(2);
}

export function loadVariantSets(sets) {
  const out = {};
  for (const set of sets) {
    if (set?.id && Array.isArray(set.groups)) out[set.id] = set.groups;
  }
  return out;
}

function groupsFor(product, variantSets) {
  if (Array.isArray(product.variants) && product.variants.length) return product.variants;
  if (product.variantSet && variantSets[product.variantSet]) return variantSets[product.variantSet];
  return [];
}

export function quoteLine(product, variantSets, request) {
  const sku = String(request?.sku || "").trim().toUpperCase();
  if (!product || product.inactive || String(product.sku || "").toUpperCase() !== sku) {
    throw new Error("That part is not for sale.");
  }
  const qty = Math.floor(Number(request?.qty));
  if (!Number.isFinite(qty) || qty < 1 || qty > QTY_MAX) {
    throw new Error("Quantity must be 1 to 10.");
  }
  const incoming = request?.options && typeof request.options === "object" ? request.options : {};
  const groups = groupsFor(product, variantSets);
  const options = {};
  const parts = [];
  let unit = Number(product.price);
  if (!Number.isFinite(unit) || unit <= 0) throw new Error("That part is not for sale.");
  for (const group of groups) {
    const picked = String(incoming[group.id] || "").trim();
    if (!picked) throw new Error("Please choose the options for " + sku + ".");
    const value = (group.values || []).find((row) => row.name === picked);
    if (!value) throw new Error("Please choose the options for " + sku + ".");
    if (/^white$/i.test(value.name)) throw new Error("That color is not offered.");
    options[group.id] = value.name;
    parts.push(group.label + ": " + value.name);
    if (typeof value.price === "number" && value.price > 0) unit = value.price;
  }
  return {
    sku: product.sku,
    name: product.name,
    href: "/tools/" + product.slug,
    qty,
    unit,
    currency: product.currency || "USD",
    options,
    optionLine: parts.join("; "),
  };
}

export function quoteLines(catalog, variantSets, requests) {
  if (!Array.isArray(requests) || !requests.length) throw new Error("Cart is empty.");
  if (requests.length > LINE_MAX) throw new Error("Too many lines.");
  const bySku = new Map(
    (catalog || []).map((product) => [String(product.sku || "").toUpperCase(), product]),
  );
  return requests.map((request) => {
    const sku = String(request?.sku || "").trim().toUpperCase();
    return quoteLine(bySku.get(sku), variantSets, request);
  });
}

function quoteKey(line) {
  return [
    String(line.sku || "").toUpperCase(),
    String(line.optionLine || ""),
    String(line.qty),
    money(line.unit),
  ].join("|");
}

export function quotesMatch(paid, quoted) {
  if (!Array.isArray(paid) || !Array.isArray(quoted) || paid.length !== quoted.length || !paid.length) {
    return false;
  }
  const left = paid.map(quoteKey).sort();
  const right = quoted.map(quoteKey).sort();
  return left.every((key, i) => key === right[i]);
}

export function itemName(line) {
  return `${line.sku ? `${line.sku} ` : ""}${line.name}`.trim();
}

export function customId(lines) {
  return lines
    .map((line) => {
      const color = line.options.color || "";
      const extra = line.options.size || line.options.pack || "";
      return [line.sku, color, extra, `x${line.qty}`].filter(Boolean).join(":");
    })
    .join(";")
    .slice(0, 127);
}

export function orderSummary(lines) {
  return lines
    .map((line) => [line.sku, line.name, line.optionLine, `Qty ${line.qty}`].filter(Boolean).join(" - "))
    .join(" | ");
}

export function linesTotal(lines) {
  return lines.reduce((sum, line) => sum + Number(money(line.unit)) * line.qty, 0);
}

export function orderTotal(lines, shipping) {
  return Number(money(linesTotal(lines))) + Number(money(shipping));
}

export function purchaseUnit(lines, currency, shipping = 0) {
  const items = money(linesTotal(lines));
  const ship = money(shipping);
  const value = money(Number(items) + Number(ship));
  return {
    reference_id: "default",
    custom_id: customId(lines),
    description: orderSummary(lines).slice(0, 127),
    amount: {
      currency_code: currency,
      value,
      breakdown: {
        item_total: { currency_code: currency, value: items },
        shipping: { currency_code: currency, value: ship },
      },
    },
    items: lines.map((line) => ({
      name: itemName(line).slice(0, 127),
      sku: String(line.sku).slice(0, 127),
      description: (line.optionLine || "Standard").slice(0, 127),
      quantity: String(line.qty),
      unit_amount: { currency_code: currency, value: money(line.unit) },
      category: "PHYSICAL_GOODS",
    })),
  };
}

export function paypalPatchAmount(lines, currency, shipping) {
  return [
    {
      op: "replace",
      path: "/purchase_units/@reference_id=='default'/amount",
      value: purchaseUnit(lines, currency, shipping).amount,
    },
  ];
}

export function paidShipping(details) {
  return money(details?.purchase_units?.[0]?.amount?.breakdown?.shipping?.value || 0);
}

export function skuList(lines) {
  return [...new Set(lines.map((line) => line.sku).filter(Boolean))].join(", ");
}

export function shippingText(details) {
  const unit = details?.purchase_units?.[0];
  const ship = unit?.shipping;
  const addr = ship?.address || {};
  const payer = details?.payer;
  const payerName =
    ship?.name?.full_name ||
    [payer?.name?.given_name, payer?.name?.surname].filter(Boolean).join(" ") ||
    "";
  return [
    payerName,
    addr.address_line_1,
    addr.address_line_2,
    [addr.admin_area_2, addr.admin_area_1, addr.postal_code].filter(Boolean).join(", "),
    addr.country_code,
  ]
    .filter(Boolean)
    .join("\n");
}

export function notifyPayload(lines, details, currency) {
  const payer = details?.payer;
  const first = lines[0];
  const ship = shippingAmount(countryFromPaypal(details));
  const items = lines
    .map((line, index) =>
      [
        `${index + 1}. ${itemName(line)}`,
        line.optionLine || "Standard",
        `Qty ${line.qty}`,
        `$${money(line.unit)} each`,
        `$${money(Number(money(line.unit)) * line.qty)}`,
      ].join(" | "),
    )
    .join("\n");
  return {
    _subject: "by3DXYZ order " + (skuList(lines) || first?.name || "cart"),
    _template: "table",
    _captcha: "false",
    sku: skuList(lines),
    product: lines.map((line) => line.name).join(", "),
    color: first?.options.color || "",
    size: first?.options.size || first?.options.pack || "",
    options: lines.map((line) => [line.sku, line.optionLine].filter(Boolean).join(" ")).join("\n"),
    items,
    line_count: String(lines.length),
    quantity: String(lines.reduce((sum, line) => sum + line.qty, 0)),
    unit_price: first ? money(first.unit) : money(0),
    shipping: money(ship) + " " + currency,
    total: money(orderTotal(lines, ship)) + " " + currency,
    paypal_order_id: details?.id || "",
    buyer_name: [payer?.name?.given_name, payer?.name?.surname].filter(Boolean).join(" "),
    buyer_email: payer?.email_address || "",
    ship_to: shippingText(details),
  };
}

export function orderSnapshot(lines, details, currency, notifyOk) {
  const first = lines[0];
  const payer = details?.payer;
  const ship = shippingAmount(countryFromPaypal(details));
  return {
    sku: skuList(lines),
    name: lines.map((line) => line.name).join(", "),
    options: first?.options || {},
    optionLine: lines.map((line) => [line.sku, line.optionLine].filter(Boolean).join(" ")).join("; "),
    qty: lines.reduce((sum, line) => sum + line.qty, 0),
    shipping: money(ship),
    total: money(orderTotal(lines, ship)),
    currency,
    paypalOrderId: details?.id || "",
    buyerEmail: payer?.email_address || "",
    shipTo: shippingText(details),
    notifyOk,
    lines: lines.map((line) => ({
      sku: line.sku,
      name: line.name,
      optionLine: line.optionLine,
      qty: line.qty,
      unit: money(line.unit),
      total: money(Number(money(line.unit)) * line.qty),
    })),
  };
}

/** Browser /thanks copy. Buyer email and ship-to stay on the shop notify only. */
export function publicOrderSnapshot(lines, details, currency, notifyOk) {
  const snapshot = orderSnapshot(lines, details, currency, notifyOk);
  return {
    sku: snapshot.sku,
    name: snapshot.name,
    options: snapshot.options,
    optionLine: snapshot.optionLine,
    qty: snapshot.qty,
    shipping: snapshot.shipping,
    total: snapshot.total,
    currency: snapshot.currency,
    paypalOrderId: snapshot.paypalOrderId,
    notifyOk: snapshot.notifyOk,
    lines: snapshot.lines,
  };
}

export function requestLines(lines) {
  return (lines || []).map((line) => ({
    sku: line.sku,
    qty: line.qty,
    options: line.options || {},
  }));
}
