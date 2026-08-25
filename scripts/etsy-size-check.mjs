import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchListingInventory, getAccessToken } from "./etsy-oauth.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}

function apiKeyHeader() {
  const key = (process.env.ETSY_API_KEY || "").trim();
  const secret = (process.env.ETSY_API_SHARED_SECRET || "").trim();
  if (key.includes(":")) return key;
  return secret ? `${key}:${secret}` : key;
}

function skuFromTitle(title = "") {
  const tail = String(title).trim().match(/[\(\[](BO-\d{3}(?:-\d+)?)[\)\]]\s*$/i);
  return tail ? tail[1].toUpperCase() : "";
}

function sizesFromInventory(inventory) {
  const sizes = new Set();
  for (const product of inventory?.products || []) {
    for (const pv of product.property_values || []) {
      if (/size/i.test(String(pv.property_name || ""))) {
        const value = String(pv.values?.[0] || "").trim();
        if (value) sizes.add(value);
      }
    }
  }
  return [...sizes].sort();
}

function flags(sizes) {
  const blob = sizes.join(" | ").toLowerCase();
  const has = (re) => sizes.some((s) => re.test(s));
  return {
    s2: has(/^2in\b/i),
    s3: has(/^3in\b/i),
    s7: has(/^7in\b/i),
    s8: has(/^8in\b/i),
    set234: /2\/3\/4/.test(blob),
    set678: /6\/7\/8/.test(blob),
  };
}

const skip = new Set(["BO-003", "BO-019-1", "BO-019-2", "BO-020"]);
const key = apiKeyHeader();
const shopName = process.env.ETSY_SHOP_NAME || "by3dxyz";
const token = await getAccessToken();
if (!key || !token) {
  console.error("Missing Etsy auth. Need ETSY_API_KEY, ETSY_API_SHARED_SECRET, and ETSY_REFRESH_TOKEN in .env.");
  process.exit(1);
}

const shopRes = await fetch(
  `https://openapi.etsy.com/v3/application/shops?shop_name=${encodeURIComponent(shopName)}`,
  { headers: { "x-api-key": key } },
);
if (!shopRes.ok) {
  console.error("SHOP_FAIL", shopRes.status);
  process.exit(1);
}
const shopId = (await shopRes.json()).results?.[0]?.shop_id;
const listings = [];
let offset = 0;
while (true) {
  const listRes = await fetch(
    `https://openapi.etsy.com/v3/application/shops/${shopId}/listings/active?limit=100&offset=${offset}`,
    { headers: { "x-api-key": key } },
  );
  if (!listRes.ok) {
    console.error("LIST_FAIL", listRes.status);
    process.exit(1);
  }
  const j = await listRes.json();
  listings.push(...(j.results ?? []));
  if (listings.length >= (j.count ?? 0) || !(j.results ?? []).length) break;
  offset += 100;
}

const rows = [];
for (const item of listings) {
  const sku = skuFromTitle(item.title || "");
  if (!sku || skip.has(sku) || /guitar\s*pick/i.test(item.title || "")) continue;
  const inv = await fetchListingInventory(item.listing_id, token, key);
  const sizes = sizesFromInventory(inv);
  const f = flags(sizes);
  const newSingles = [f.s2, f.s3, f.s7, f.s8].filter(Boolean).length;
  let status = "NEED";
  if (newSingles === 4) status = "HAS 2/3/7/8";
  else if (newSingles > 0) status = `PARTIAL ${newSingles}/4`;
  rows.push({ sku, status, f });
  await new Promise((r) => setTimeout(r, 150));
}

rows.sort((a, b) => a.sku.localeCompare(b.sku));
const done = rows.filter((r) => r.status.startsWith("HAS"));
const partial = rows.filter((r) => r.status.startsWith("PARTIAL"));
const need = rows.filter((r) => r.status === "NEED");

const lines = [];
lines.push(`Etsy size check ${new Date().toISOString().slice(0, 16)}`);
lines.push(`Throwing ribs checked: ${rows.length}`);
lines.push(`Has 2/3/7/8: ${done.length}`);
lines.push(`Partial: ${partial.length}`);
lines.push(`Still need all four: ${need.length}`);
lines.push("");
lines.push("DONE (has 2in, 3in, 7in, 8in)");
for (const r of done) {
  const extra = [r.f.set234 && "set 2/3/4", r.f.set678 && "set 6/7/8"].filter(Boolean).join(", ");
  lines.push(`  ${r.sku}  ${extra || "singles only"}`);
}
lines.push("");
lines.push("PARTIAL");
for (const r of partial) {
  const got = [r.f.s2 && "2in", r.f.s3 && "3in", r.f.s7 && "7in", r.f.s8 && "8in"].filter(Boolean);
  lines.push(`  ${r.sku}  has ${got.join(", ")}`);
}
lines.push("");
lines.push("STILL NEED 2/3/7/8");
for (const r of need) lines.push(`  ${r.sku}`);
lines.push("");
lines.push("Skipped on purpose: BO-003, BO-019-1, BO-019-2, BO-020, guitar picks");

const out = lines.join("\n");
const privateDir = join(root, "_private", "etsy");
if (existsSync(join(root, "_private"))) {
  mkdirSync(privateDir, { recursive: true });
  writeFileSync(join(privateDir, "size-progress.txt"), `${out}\n`);
}
console.log(out);
