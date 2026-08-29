import catalog from "../../../src/data/products.json";
import ribVariants from "../../../src/data/rib-variants.json";
import pickVariants from "../../../src/data/pick-variants.json";
import colorVariants from "../../../src/data/color-variants.json";
import decorVariants from "../../../src/data/decor-variants.json";
import {
  loadVariantSets,
  notifyPayload,
  orderSnapshot,
  purchaseUnit,
  quoteLines,
} from "../../../scripts/checkout-price.mjs";

const variantSets = loadVariantSets([ribVariants, pickVariants, colorVariants, decorVariants]);

let tokenCache = { value: "", exp: 0 };

function origins(env) {
  return String(env.ALLOWED_ORIGINS || "https://by3dxyz.com")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function corsHeaders(env, request) {
  const origin = request.headers.get("Origin") || "";
  const allow = origins(env).includes(origin) ? origin : origins(env)[0];
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

async function createOrder(env, request) {
  const body = await request.json();
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
      purchase_units: [purchaseUnit(lines, currency)],
    }),
  });
  if (!created.id) throw new Error("PayPal did not return an order.");
  return { id: created.id };
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
    const name = String(item.name || "").replace(new RegExp("^" + sku.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s+"), "");
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

async function captureOrder(env, request) {
  const body = await request.json();
  const orderID = String(body.orderID || "").trim();
  if (!orderID) throw new Error("Missing PayPal order.");
  let details = await paypalFetch(env, "/v2/checkout/orders/" + encodeURIComponent(orderID) + "/capture", {
    method: "POST",
    body: "{}",
  });
  if (!details?.purchase_units?.[0]?.items?.length) {
    details = await paypalFetch(env, "/v2/checkout/orders/" + encodeURIComponent(orderID));
  }
  const lines = linesFromPaypal(details);
  if (!lines.length) throw new Error("PayPal capture had no line items.");
  const currency = details?.purchase_units?.[0]?.amount?.currency_code || lines[0]?.currency || "USD";
  const notifyOk = await Promise.race([
    notifyShop(env, lines, details, currency),
    new Promise((resolve) => setTimeout(() => resolve(false), 8000)),
  ]);
  return { details, snapshot: orderSnapshot(lines, details, currency, Boolean(notifyOk)), notifyOk: Boolean(notifyOk) };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env, request) });
    }
    if (request.method !== "POST") return json(env, request, { error: "Method not allowed." }, 405);
    if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_SECRET) {
      return json(env, request, { error: "Checkout is not configured." }, 503);
    }
    const url = new URL(request.url);
    try {
      if (url.pathname === "/order" || url.pathname === "/") return json(env, request, await createOrder(env, request));
      if (url.pathname === "/capture") return json(env, request, await captureOrder(env, request));
      return json(env, request, { error: "Not found." }, 404);
    } catch (err) {
      return json(env, request, { error: err instanceof Error ? err.message : "Checkout failed." }, 400);
    }
  },
};
