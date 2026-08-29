import { clearCart, loadCart, readBuyState, type CartLine } from "./shop-cart";

export type PayPalDetails = {
  id?: string;
  payer?: {
    email_address?: string;
    name?: { given_name?: string; surname?: string };
  };
  purchase_units?: Array<{
    shipping?: {
      name?: { full_name?: string };
      address?: {
        address_line_1?: string;
        address_line_2?: string;
        admin_area_1?: string;
        admin_area_2?: string;
        postal_code?: string;
        country_code?: string;
      };
    };
  }>;
};

type PayPalSdk = {
  FUNDING: { PAYPAL: string; PAYLATER: string; CARD: string };
  isFundingEligible?: (source: string) => boolean;
  Buttons: (config: Record<string, unknown>) => { render: (node: Element) => Promise<void> };
};

export function money(value: number): string {
  return (Math.round(Number(value) * 100) / 100).toFixed(2);
}

export function shippingText(details: PayPalDetails | undefined): string {
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

export function itemName(line: CartLine): string {
  return `${line.sku ? `${line.sku} ` : ""}${line.name}`.trim();
}

export function customId(lines: CartLine[]): string {
  return lines
    .map((line) => {
      const color = line.options.color || "";
      const extra = line.options.size || line.options.pack || "";
      return [line.sku, color, extra, `x${line.qty}`].filter(Boolean).join(":");
    })
    .join(";")
    .slice(0, 127);
}

export function orderSummary(lines: CartLine[]): string {
  return lines
    .map((line) =>
      [line.sku, line.name, line.optionLine, `Qty ${line.qty}`].filter(Boolean).join(" - "),
    )
    .join(" | ");
}

export function linesTotal(lines: CartLine[]): number {
  return lines.reduce((sum, line) => sum + Number(money(line.unit)) * line.qty, 0);
}

export function purchaseUnit(lines: CartLine[], currency: string) {
  const value = money(linesTotal(lines));
  return {
    custom_id: customId(lines),
    description: orderSummary(lines).slice(0, 127),
    amount: {
      currency_code: currency,
      value,
      breakdown: {
        item_total: { currency_code: currency, value },
      },
    },
    items: lines.map((line) => ({
      name: itemName(line).slice(0, 127),
      sku: line.sku.slice(0, 127),
      description: (line.optionLine || "Standard").slice(0, 127),
      quantity: String(line.qty),
      unit_amount: { currency_code: currency, value: money(line.unit) },
      category: "PHYSICAL_GOODS",
    })),
  };
}

export function skuList(lines: CartLine[]): string {
  return [...new Set(lines.map((line) => line.sku).filter(Boolean))].join(", ");
}

export function notifyPayload(
  lines: CartLine[],
  details: PayPalDetails | undefined,
  currency: string,
): Record<string, string> {
  const payer = details?.payer;
  const first = lines[0];
  const items = lines
    .map((line, index) => {
      const total = money(Number(money(line.unit)) * line.qty);
      return [
        `${index + 1}. ${itemName(line)}`,
        line.optionLine || "Standard",
        `Qty ${line.qty}`,
        `$${money(line.unit)} each`,
        `$${total}`,
      ].join(" | ");
    })
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
    total: money(linesTotal(lines)) + " " + currency,
    paypal_order_id: details?.id || "",
    buyer_name: [payer?.name?.given_name, payer?.name?.surname].filter(Boolean).join(" "),
    buyer_email: payer?.email_address || "",
    ship_to: shippingText(details),
  };
}

function postNotify(notifyEmail: string, payload: Record<string, string>) {
  return fetch("https://formsubmit.co/ajax/" + encodeURIComponent(notifyEmail), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  }).then((res) => {
    if (!res.ok) throw new Error(String(res.status));
    return res;
  });
}

export function notifyShop(
  lines: CartLine[],
  details: PayPalDetails | undefined,
  currency: string,
  notifyEmail: string,
): Promise<boolean> {
  if (!notifyEmail || !lines.length) return Promise.resolve(false);
  const payload = notifyPayload(lines, details, currency);
  return postNotify(notifyEmail, payload)
    .catch(() => postNotify(notifyEmail, payload))
    .then(() => true)
    .catch(() => false);
}

export function orderSnapshot(
  lines: CartLine[],
  details: PayPalDetails | undefined,
  currency: string,
  notifyOk: boolean,
) {
  const first = lines[0];
  const payer = details?.payer;
  return {
    sku: skuList(lines),
    name: lines.map((line) => line.name).join(", "),
    options: first?.options || {},
    optionLine: lines.map((line) => [line.sku, line.optionLine].filter(Boolean).join(" ")).join("; "),
    qty: lines.reduce((sum, line) => sum + line.qty, 0),
    total: money(linesTotal(lines)),
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

function paypalSdk(): PayPalSdk | undefined {
  return (window as Window & { paypal?: PayPalSdk }).paypal;
}

function loadSdk(clientId: string, currency: string): Promise<PayPalSdk | undefined> {
  const existing = paypalSdk();
  if (existing) return Promise.resolve(existing);
  const src =
    "https://www.paypal.com/sdk/js?client-id=" +
    encodeURIComponent(clientId) +
    "&currency=" +
    encodeURIComponent(currency) +
    "&enable-funding=card,paylater&disable-funding=venmo";
  const waiting = document.querySelector(`script[src^="https://www.paypal.com/sdk/js"]`);
  return new Promise((resolve) => {
    const done = () => resolve(paypalSdk());
    if (waiting) {
      waiting.addEventListener("load", done);
      if (paypalSdk()) done();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.onload = done;
    script.onerror = () => resolve(undefined);
    document.head.appendChild(script);
  });
}

function requestLines(lines: CartLine[]) {
  return lines.map((line) => ({ sku: line.sku, qty: line.qty, options: line.options || {} }));
}

function checkoutEndpoint(raw: string) {
  return raw.replace(/\/$/, "");
}

function turnstileApi() {
  return window.turnstile;
}

function loadTurnstile(): Promise<NonNullable<Window["turnstile"]> | undefined> {
  const existing = turnstileApi();
  if (existing) return Promise.resolve(existing);
  const waiting = document.querySelector('script[src*="challenges.cloudflare.com/turnstile"]');
  return new Promise((resolve) => {
    const done = () => resolve(turnstileApi());
    if (waiting) {
      waiting.addEventListener("load", done);
      if (turnstileApi()) done();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = done;
    script.onerror = () => resolve(undefined);
    document.head.appendChild(script);
  });
}

function checkoutProof(siteKey: string): Promise<string> {
  return loadTurnstile().then((turnstile) => {
    if (!turnstile || !siteKey) return Promise.reject(new Error("Checkout failed."));
    return new Promise((resolve, reject) => {
      const box = document.createElement("div");
      box.hidden = true;
      document.body.appendChild(box);
      const fail = () => {
        try {
          turnstile.remove(id);
        } catch {
          /* already gone */
        }
        box.remove();
        reject(new Error("Checkout failed."));
      };
      const id = turnstile.render(box, {
        sitekey: siteKey,
        size: "invisible",
        execution: "execute",
        callback: (token: string) => {
          try {
            turnstile.remove(id);
          } catch {
            /* already gone */
          }
          box.remove();
          if (!token) {
            reject(new Error("Checkout failed."));
            return;
          }
          resolve(token);
        },
        "error-callback": fail,
        "timeout-callback": fail,
      });
      turnstile.execute(id);
    });
  });
}

export function mountPayPal(opts: {
  container: HTMLElement;
  clientId: string;
  currency: string;
  notifyEmail: string;
  checkoutUrl?: string;
  siteKey?: string;
  getLines: () => CartLine[] | null;
  clearOnPay?: boolean;
}): void {
  const { container, clientId, currency, getLines, clearOnPay } = opts;
  const checkoutUrl = checkoutEndpoint(opts.checkoutUrl || "");
  const siteKey = String(opts.siteKey || "").trim();
  if (!clientId || !checkoutUrl || !siteKey || container.dataset.ready === "true") return;
  container.dataset.ready = "true";

  loadTurnstile();
  loadSdk(clientId, currency).then((paypal) => {
    if (!paypal) return;

    let captureTicket = "";

    function goThanks(snapshot: ReturnType<typeof orderSnapshot>) {
      try {
        sessionStorage.setItem("by3dxyz-order", JSON.stringify(snapshot));
      } catch {
        /* private mode */
      }
      if (clearOnPay) clearCart();
      window.location.href = "/thanks";
    }

    const shared = {
      onClick: function (_data: unknown, actions: { reject: () => unknown; resolve: () => unknown }) {
        const lines = getLines();
        if (!lines || !lines.length) return actions.reject();
        return actions.resolve();
      },
      createOrder: function () {
        const lines = getLines();
        if (!lines || !lines.length) return Promise.reject(new Error("empty"));
        return checkoutProof(siteKey).then((turnstile) =>
          fetch(checkoutUrl + "/order", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lines: requestLines(lines), turnstile }),
          }).then(async (res) => {
            const body = await res.json().catch(() => ({}));
            if (!res.ok || !body.id || !body.ticket) throw new Error(body.error || "Checkout failed.");
            captureTicket = String(body.ticket);
            return body.id as string;
          }),
        );
      },
      onApprove: function (data: { orderID?: string }) {
        return fetch(checkoutUrl + "/capture", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderID: data.orderID || "", ticket: captureTicket }),
        }).then(async (res) => {
          const body = await res.json().catch(() => ({}));
          if (!res.ok || !body.snapshot) throw new Error(body.error || "Capture failed.");
          goThanks(body.snapshot);
        });
      },
    };

    function mount(source: string | undefined, slot: string, style: Record<string, unknown>) {
      const node = container.querySelector(`[data-paypal-slot="${slot}"]`);
      if (!source || !node) return;
      const eligible = typeof paypal.isFundingEligible !== "function" || paypal.isFundingEligible(source);
      if (!eligible) {
        if (node instanceof HTMLElement) node.hidden = true;
        return;
      }
      paypal
        .Buttons(Object.assign({ fundingSource: source, style }, shared))
        .render(node)
        .catch(() => {
          if (node instanceof HTMLElement) node.hidden = true;
        });
    }

    mount(paypal.FUNDING.PAYPAL, "paypal", {
      color: "gold",
      shape: "rect",
      label: "paypal",
      height: 45,
      tagline: false,
    });
    mount(paypal.FUNDING.PAYLATER, "paylater", {
      color: "gold",
      shape: "rect",
      label: "paypal",
      height: 45,
      tagline: false,
    });
    mount(paypal.FUNDING.CARD, "card", {
      color: "black",
      shape: "rect",
      label: "pay",
      height: 45,
      tagline: false,
    });
  });
}

export function bootPayPalMounts(): void {
  for (const node of document.querySelectorAll("[data-paypal-mount]")) {
    if (!(node instanceof HTMLElement)) continue;
    const clientId = node.getAttribute("data-paypal-client") || "";
    const currency = node.getAttribute("data-paypal-currency") || "USD";
    const notifyEmail = node.getAttribute("data-paypal-notify") || "";
    const checkoutUrl = node.getAttribute("data-paypal-checkout") || "";
    const siteKey = node.getAttribute("data-turnstile-site") || "";
    const mode = node.getAttribute("data-paypal-mode") || "buy";
    if (!clientId || !checkoutUrl || !siteKey) continue;
    mountPayPal({
      container: node,
      clientId,
      currency,
      notifyEmail,
      checkoutUrl,
      siteKey,
      clearOnPay: mode === "cart",
      getLines: () => {
        if (mode === "cart") {
          const lines = loadCart();
          return lines.length ? lines : null;
        }
        const buy = node.closest("[data-buy]") || document.querySelector("[data-buy]");
        if (!buy) return null;
        const state = readBuyState(buy);
        return state.ready ? [state.line] : null;
      },
    });
  }
}
