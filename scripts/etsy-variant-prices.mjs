// Print the real per-option prices Etsy charges for a listing, so the website
// variant JSON can match. Usage:
//   node scripts/etsy-variant-prices.mjs 4563997517
//   node scripts/etsy-variant-prices.mjs BO-053
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

const arg = (process.argv[2] || "").trim();
if (!arg) {
  console.error("Pass an Etsy listing id or a SKU. Example: node scripts/etsy-variant-prices.mjs BO-053");
  process.exit(1);
}

let listingId = arg;
let label = arg;
if (!/^\d+$/.test(arg)) {
  const products = JSON.parse(readFileSync(join(root, "src", "data", "products.json"), "utf8"));
  const match = products.find((p) => (p.sku || "").toUpperCase() === arg.toUpperCase());
  if (!match?.etsyListingId) {
    console.error(`No Etsy listing found for ${arg}`);
    process.exit(1);
  }
  listingId = match.etsyListingId;
  label = `${match.sku} ${match.name} (base $${match.price})`;
}

const token = await getAccessToken();
if (!token) {
  console.error("No Etsy access token. Run: npm run catalog:auth");
  process.exit(1);
}

const inventory = await fetchListingInventory(listingId, token, apiKeyHeader());
if (!inventory) {
  console.error(`Could not read inventory for listing ${listingId}`);
  process.exit(1);
}

console.log(`${label}\nlisting ${listingId}\n`);

const byOption = new Map();
for (const product of inventory.products || []) {
  const names = (product.property_values || [])
    .map((pv) => `${pv.property_name}: ${(pv.values || []).join("/")}`)
    .join("  |  ");
  for (const offering of product.offerings || []) {
    const price = (offering.price?.amount ?? 0) / (offering.price?.divisor || 100);
    const key = names || "(no options)";
    if (!byOption.has(key)) byOption.set(key, new Set());
    byOption.get(key).add(price.toFixed(2));
  }
}

for (const [option, prices] of byOption) {
  console.log(`${option}  ->  $${[...prices].join(", $")}`);
}

console.log(`\n${byOption.size} option combinations.`);
