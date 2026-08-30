import catalog from "../../../src/data/products.json";
import ribVariants from "../../../src/data/rib-variants.json";
import pickVariants from "../../../src/data/pick-variants.json";
import colorVariants from "../../../src/data/color-variants.json";
import decorVariants from "../../../src/data/decor-variants.json";
import coffinVariants from "../../../src/data/coffin-variants.json";
import {
  countryFromPaypal,
  loadVariantSets,
  money,
  notifyPayload,
  orderTotal,
  paypalPatchAmount,
  publicOrderSnapshot,
  purchaseUnit,
  quoteLines,
  quotesMatch,
  shippingAmount,
} from "../../../scripts/checkout-price.mjs";
import { buildInboxPayload } from "./inbox.js";

const variantSets = loadVariantSets([ribVariants, pickVariants, colorVariants, decorVariants, coffinVariants]);
const hits = new Map();

let tokenCache = { value: "", exp: 0 };

function origins(env) {
  return String(env.ALLOWED_ORIGINS || "https://by3dxyz.com")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isAllowedOrigin(env, request) {
  const origin = request.headers.get("Origin") || "";
  return origins(env).includes(origin);
}

function corsHeaders(env, request) {
  const origin = request.headers.get("Origin") || "";
  const allow = isAllowedOrigin(env, request) ? origin : origins(env)[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function json(env, request, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(env, request) },
  });
}

function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || request.headers.get("CF-Connecting-IPv6") || "unknown";
}

function tooMany(ip, limit, windowMs) {
  const now = Date.now();
  const key = ip + ":" + String(limit) + ":" + String(windowMs);
  const fresh = (hits.get(key) || []).filter((stamp) => now - stamp < windowMs);
  if (fresh.length >= limit) {
    hits.set(key, fresh);
    return true;
  }
  fresh.push(now);
  hits.set(key, fresh);
  return false;
}

function isPayPalOrderId(value) {
  return /^[A-Z0-9]{8,30}$/i.test(value);
}

function bytesToTicket(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function captureTicket(env, orderId) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(env.PAYPAL_SECRET || "")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("by3dxyz-capture:" + orderId));
  return bytesToTicket(mac);
}

async function ticketMatches(env, orderId, ticket) {
  const expected = await captureTicket(env, orderId);
  return expected === String(ticket || "") && expected.length > 20;
}

function safeError(err) {
  const msg = err instanceof Error ? err.message : "Checkout failed.";
  if (
    /not for sale|Quantity must|Cart is empty|Too many lines|options for|color is not offered|Please check the form/i.test(
      msg,
    )
  ) {
    return msg;
  }
  return "Checkout failed.";
}

async function paypalToken(env) {
  if (tokenCache.value && Date.now() < tokenCache.exp) return tokenCache.value;
  const api = env.PAYPAL_API || "https://api-m.paypal.com";
  const auth = btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_SECRET}`);
  const res = await fetch(api + "/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + auth,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error("PayPal auth failed.");
  const data = await res.json();
  tokenCache = {
    value: data.access_token,
    exp: Date.now() + Math.max(30, Number(data.expires_in || 300) - 60) * 1000,
  };
  return tokenCache.value;
}

async function paypalFetch(env, path, init = {}) {
  const api = env.PAYPAL_API || "https://api-m.paypal.com";
  const token = await paypalToken(env);
  const res = await fetch(api + path, {
    ...init,
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || "PayPal request failed.");
  return data;
}

async function notifyShop(env, lines, details, currency) {
  const email = String(env.ORDER_NOTIFY_EMAIL || "").trim();
  if (!email) return false;
  const payload = notifyPayload(lines, details, currency);
  const url = "https://formsubmit.co/ajax/" + encodeURIComponent(email);
  const send = () =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    }).then((res) => {
      if (!res.ok) throw new Error(String(res.status));
      return res;
    });
  try {
    await send();
    return true;
  } catch {
    try {
      await send();
      return true;
    } catch {
      return false;
    }
  }
}

async function verifyTurnstile(env, token, ip) {
  const secret = String(env.TURNSTILE_SECRET || "").trim();
  if (!secret) throw new Error("Checkout is not configured.");
  const proof = String(token || "").trim();
  if (proof.length < 20) throw new Error("Checkout failed.");
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      secret,
      response: proof,
      remoteip: ip,
    }).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.success) throw new Error("Checkout failed.");
}

async function createOrder(env, request, ip) {
  const body = await request.json();
  await verifyTurnstile(env, body.turnstile, ip);
  const lines = quoteLines(catalog, variantSets, body.lines || []);
  const currency = lines[0]?.currency || "USD";
  const created = await paypalFetch(env, "/v2/checkout/orders", {
    method: "POST",
    body: JSON.stringify({
      intent: "CAPTURE",
      application_context: {
        brand_name: "by3DXYZ",
        user_action: "PAY_NOW",
        shipping_preference: "GET_FROM_FILE",
      },
      purchase_units: [purchaseUnit(lines, currency, 0)],
    }),
  });
  if (!created.id) throw new Error("PayPal did not return an order.");
  return { id: created.id, ticket: await captureTicket(env, created.id) };
}

async function updateShipping(env, request) {
  const body = await request.json();
  const orderID = String(body.orderID || "").trim();
  if (!isPayPalOrderId(orderID) || !(await ticketMatches(env, orderID, body.ticket))) {
    throw new Error("Missing PayPal order.");
  }
  const pending = await paypalFetch(env, "/v2/checkout/orders/" + encodeURIComponent(orderID));
  const paid = linesFromPaypal(pending);
  const quoted = quotedFromPaid(paid);
  if (!quoted.length || !quotesMatch(paid, quoted)) throw new Error("Checkout failed.");
  const country = countryFromPaypal(pending) || String(body.country || "").trim();
  const shipping = shippingAmount(country);
  const currency = quoted[0]?.currency || "USD";
  await paypalFetch(env, "/v2/checkout/orders/" + encodeURIComponent(orderID), {
    method: "PATCH",
    body: JSON.stringify(paypalPatchAmount(quoted, currency, shipping)),
  });
  return { ok: true, shipping: money(shipping) };
}

function optionsFromDescription(description) {
  const options = {};
  for (const part of String(description || "").split(";")) {
    const split = part.indexOf(":");
    if (split < 0) continue;
    const label = part.slice(0, split).trim();
    const value = part.slice(split + 1).trim();
    if (!value) continue;
    if (/color/i.test(label)) options.color = value;
    else if (/pack/i.test(label)) options.pack = value;
    else if (/size|thickness/i.test(label)) options.size = value;
  }
  return options;
}

function linesFromPaypal(details) {
  const items = details?.purchase_units?.[0]?.items || [];
  return items.map((item) => {
    const sku = String(item.sku || "");
    const name = String(item.name || "").replace(
      new RegExp("^" + sku.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s+"),
      "",
    );
    return {
      sku,
      name,
      href: "",
      qty: Number(item.quantity),
      unit: Number(item.unit_amount?.value),
      currency: item.unit_amount?.currency_code || "USD",
      options: optionsFromDescription(item.description),
      optionLine: item.description || "Standard",
    };
  });
}

function quotedFromPaid(paid) {
  return quoteLines(
    catalog,
    variantSets,
    paid.map((line) => ({ sku: line.sku, qty: line.qty, options: line.options || {} })),
  );
}

function assertCatalogPrice(details, paid) {
  const quoted = quotedFromPaid(paid);
  if (!quotesMatch(paid, quoted)) throw new Error("Checkout failed.");
  const shipping = shippingAmount(countryFromPaypal(details));
  const paidShip = money(details?.purchase_units?.[0]?.amount?.breakdown?.shipping?.value || 0);
  if (paidShip !== money(shipping)) throw new Error("Checkout failed.");
  const paidTotal = money(details?.purchase_units?.[0]?.amount?.value);
  if (paidTotal !== money(orderTotal(quoted, shipping))) throw new Error("Checkout failed.");
}

function withShipCountry(details, fallback) {
  const unit = details?.purchase_units?.[0];
  const prior = fallback?.purchase_units?.[0];
  if (!unit || !prior) return details;
  const units = details.purchase_units.slice();
  units[0] = {
    ...unit,
    shipping: unit.shipping || prior.shipping,
    amount: {
      ...unit.amount,
      breakdown: unit.amount?.breakdown || prior.amount?.breakdown,
    },
  };
  return { ...details, purchase_units: units };
}

async function captureOrder(env, request) {
  const body = await request.json();
  const orderID = String(body.orderID || "").trim();
  if (!isPayPalOrderId(orderID) || !(await ticketMatches(env, orderID, body.ticket))) {
    throw new Error("Missing PayPal order.");
  }
  const pending = await paypalFetch(env, "/v2/checkout/orders/" + encodeURIComponent(orderID));
  const pendingLines = linesFromPaypal(pending);
  if (!pendingLines.length) throw new Error("Checkout failed.");
  assertCatalogPrice(pending, pendingLines);
  let details = await paypalFetch(env, "/v2/checkout/orders/" + encodeURIComponent(orderID) + "/capture", {
    method: "POST",
    body: "{}",
  });
  if (!details?.purchase_units?.[0]?.items?.length) {
    details = await paypalFetch(env, "/v2/checkout/orders/" + encodeURIComponent(orderID));
  }
  details = withShipCountry(details, pending);
  const lines = linesFromPaypal(details);
  if (!lines.length) throw new Error("PayPal capture had no line items.");
  assertCatalogPrice(details, lines);
  const currency = details?.purchase_units?.[0]?.amount?.currency_code || lines[0]?.currency || "USD";
  const notifyOk = await Promise.race([
    notifyShop(env, lines, details, currency),
    new Promise((resolve) => setTimeout(() => resolve(false), 8000)),
  ]);
  return {
    snapshot: publicOrderSnapshot(quotedFromPaid(lines), details, currency, Boolean(notifyOk)),
    notifyOk: Boolean(notifyOk),
  };
}

async function postFormsubmit(env, payload) {
  const email = String(env.ORDER_NOTIFY_EMAIL || "").trim();
  if (!email) throw new Error("Checkout is not configured.");
  const url = "https://formsubmit.co/ajax/" + encodeURIComponent(email);
  const send = () =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    }).then((res) => {
      if (!res.ok) throw new Error(String(res.status));
      return res;
    });
  try {
    await send();
    return true;
  } catch {
    await send();
    return true;
  }
}

async function inboxOrder(env, request) {
  const built = buildInboxPayload(await request.json());
  if (built.skip) return { ok: true };
  await postFormsubmit(env, built.payload);
  return { ok: true };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env, request) });
    }
    if (request.method !== "POST") return json(env, request, { error: "Method not allowed." }, 405);
    if (!isAllowedOrigin(env, request)) {
      return json(env, request, { error: "Checkout failed." }, 403);
    }
    const size = Number(request.headers.get("Content-Length") || 0);
    if (size > 50000) return json(env, request, { error: "Checkout failed." }, 413);
    const url = new URL(request.url);
    const ip = clientIp(request);
    try {
      if (url.pathname === "/inbox") {
        if (tooMany(ip + ":inbox", 6, 10 * 60 * 1000)) {
          return json(env, request, { error: "Try again in a few minutes." }, 429);
        }
        if (!env.ORDER_NOTIFY_EMAIL) return json(env, request, { error: "Could not send." }, 503);
        return json(env, request, await inboxOrder(env, request));
      }
      if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_SECRET || !env.TURNSTILE_SECRET) {
        return json(env, request, { error: "Checkout is not configured." }, 503);
      }
      if (url.pathname === "/order") {
        if (tooMany(ip + ":order", 8, 15 * 60 * 1000)) {
          return json(env, request, { error: "Try checkout again in a few minutes." }, 429);
        }
        return json(env, request, await createOrder(env, request, ip));
      }
      if (url.pathname === "/shipping") {
        if (tooMany(ip + ":shipping", 16, 15 * 60 * 1000)) {
          return json(env, request, { error: "Try checkout again in a few minutes." }, 429);
        }
        return json(env, request, await updateShipping(env, request));
      }
      if (url.pathname === "/capture") {
        if (tooMany(ip + ":capture", 12, 15 * 60 * 1000)) {
          return json(env, request, { error: "Try checkout again in a few minutes." }, 429);
        }
        return json(env, request, await captureOrder(env, request));
      }
      return json(env, request, { error: "Not found." }, 404);
    } catch (err) {
      return json(env, request, { error: safeError(err) }, 400);
    }
  },
};
