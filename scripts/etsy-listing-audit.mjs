import { readFileSync, existsSync } from "node:fs";
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

function parseTitlesFile(text) {
  const wanted = new Map();
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const sku = lines[i].trim().match(/^(BO-\d{3}(?:-\d+)?)$/i)?.[1]?.toUpperCase();
    if (!sku) continue;
    const title = (lines[i + 1] || "").trim();
    if (title) wanted.set(sku, title);
  }
  return wanted;
}

const SIZE_PRICES = [
  { id: "2in", re: /^2in\b/i, price: 10 },
  { id: "3in", re: /^3in\b/i, price: 11 },
  { id: "4in", re: /^4in\b/i, price: 12 },
  { id: "5in", re: /^5in\b/i, price: 13 },
  { id: "6in", re: /^6in\b/i, price: 14 },
  { id: "7in", re: /^7in\b/i, price: 16.5 },
  { id: "8in", re: /^8in\b/i, price: 18.5 },
  { id: "set234", re: /2\s*\/\s*3\s*\/\s*4/i, price: 28 },
  { id: "set456", re: /4\s*\/\s*5\s*\/\s*6/i, price: 32 },
  { id: "set678", re: /6\s*\/\s*7\s*\/\s*8/i, price: 40 },
];

const NEED_SIZES = new Set(
  [
    "001",
    "002",
    ...Array.from({ length: 15 }, (_, i) => String(i + 4).padStart(3, "0")),
    ...Array.from({ length: 32 }, (_, i) => String(i + 21).padStart(3, "0")),
  ].map((n) => `BO-${n}`),
);

function money(offering) {
  const p = offering?.price;
  if (!p) return null;
  return Number(p.amount) / (p.divisor || 100);
}

function sizePrices(inventory) {
  const bySize = new Map();
  for (const product of inventory?.products || []) {
    const offering =
      (product.offerings || []).find((row) => row.is_enabled !== false && row.is_deleted !== true) ||
      product.offerings?.[0];
    if (!offering) continue;
    let size = "";
    for (const pv of product.property_values || []) {
      if (/size/i.test(String(pv.property_name || ""))) {
        size = String(pv.values?.[0] || "").trim();
      }
    }
    if (!size) continue;
    const price = money(offering);
    const prev = bySize.get(size);
    if (!prev) bySize.set(size, new Set([price]));
    else prev.add(price);
  }
  return bySize;
}

function classifySize(label) {
  return SIZE_PRICES.find((row) => row.re.test(label)) || null;
}

const titlesPath = join(root, "_private", "etsy", "titles.txt");
if (!existsSync(titlesPath)) {
  console.error("Missing _private/etsy/titles.txt");
  process.exit(1);
}

const wanted = parseTitlesFile(readFileSync(titlesPath, "utf8"));
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

const live = new Map();
for (const item of listings) {
  const sku = skuFromTitle(item.title || "");
  if (!sku) continue;
  live.set(sku, item);
}

const titleWrong = [];
const titleMissing = [];
const sizeMissing = [];
const priceWrong = [];
const extraSizes = [];
const okRibs = [];

for (const [sku, expectedTitle] of wanted) {
  const item = live.get(sku);
  if (!item) {
    titleMissing.push(`${sku}  not in active listings`);
    continue;
  }
  const liveTitle = String(item.title || "").trim();
  if (liveTitle !== expectedTitle) {
    titleWrong.push({ sku, liveTitle, expectedTitle });
  }

  if (!NEED_SIZES.has(sku)) continue;

  const inv = await fetchListingInventory(item.listing_id, token, key);
  const bySize = sizePrices(inv);
  const found = new Map();
  const unexpected = [];
  for (const [label, prices] of bySize) {
    const kind = classifySize(label);
    if (!kind) {
      unexpected.push(`${label} @ ${[...prices].join("/")}`);
      continue;
    }
    if (!found.has(kind.id)) found.set(kind.id, { label, prices: new Set() });
    for (const p of prices) found.get(kind.id).prices.add(p);
  }

  const missingIds = SIZE_PRICES.filter((row) => !found.has(row.id)).map((row) => row.id);
  if (missingIds.length) sizeMissing.push({ sku, missingIds });

  for (const row of SIZE_PRICES) {
    const hit = found.get(row.id);
    if (!hit) continue;
    const bad = [...hit.prices].filter((p) => p !== row.price);
    if (bad.length || hit.prices.size !== 1) {
      priceWrong.push({ sku, size: hit.label, want: row.price, got: [...hit.prices] });
    }
  }
  if (unexpected.length) extraSizes.push({ sku, unexpected });
  if (!missingIds.length && !priceWrong.some((r) => r.sku === sku)) okRibs.push(sku);

  await new Promise((r) => setTimeout(r, 150));
}

const extraLive = [...live.keys()]
  .filter((sku) => !wanted.has(sku) && !/guitar/i.test(live.get(sku).title || ""))
  .sort();

const lines = [];
lines.push(`Etsy listing audit ${new Date().toISOString().slice(0, 16)}`);
lines.push(`titles.txt SKUs: ${wanted.size}  active matched: ${[...wanted.keys()].filter((s) => live.has(s)).length}`);
lines.push(`Ribs with all 10 sizes + correct prices: ${okRibs.length}/${NEED_SIZES.size}`);
lines.push("");
lines.push("TITLES");
if (!titleWrong.length && !titleMissing.length) lines.push("  all titles.txt rows match live titles");
for (const row of titleWrong) {
  lines.push(`  ${row.sku} MISMATCH`);
  lines.push(`    live: ${row.liveTitle}`);
  lines.push(`    want: ${row.expectedTitle}`);
}
for (const row of titleMissing) lines.push(`  ${row}`);
if (extraLive.length) lines.push(`  extra active SKUs not in titles.txt: ${extraLive.join(", ")}`);
lines.push("");
lines.push("SIZES still missing (need all 10)");
if (!sizeMissing.length) lines.push("  none");
for (const row of sizeMissing) lines.push(`  ${row.sku}  missing ${row.missingIds.join(", ")}`);
lines.push("");
lines.push("PRICES wrong");
if (!priceWrong.length) lines.push("  none");
for (const row of priceWrong) {
  lines.push(`  ${row.sku}  ${row.size}  want $${row.want.toFixed(2)}  got $${row.got.map((n) => n.toFixed(2)).join(" / ")}`);
}
lines.push("");
lines.push("Unexpected size labels");
if (!extraSizes.length) lines.push("  none");
for (const row of extraSizes) lines.push(`  ${row.sku}  ${row.unexpected.join("; ")}`);

console.log(lines.join("\n"));
