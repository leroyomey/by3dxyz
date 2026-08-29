/**
 * Write public/google-merchant.xml from the website catalog.
 * One row per SKU (not per color or size). No White. Website titles, not Etsy titles.
 *
 * This file is the Google Merchant Center automation (same idea as Etsy → website sync).
 * Owner stays on "Add products from a file" and sets a scheduled fetch of
 * https://by3dxyz.com/google-merchant.xml (daily). Do not add products one by one.
 * Do not build Merchant API OAuth unless the scheduled file feed cannot do the job.
 *
 * Shipping matches PayPal: US and US territories $0, other listed countries
 * INTERNATIONAL_SHIPPING_USD. Google has no rest-of-world wildcard and caps 100
 * shipping rows per product, so GMC account shipping should also be US $0 / rest $18
 * for any extra target country. identifier_exists stays false.
 */
import { INTERNATIONAL_SHIPPING_USD, FREE_SHIP_COUNTRIES } from "./checkout-price.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const productsPath = join(root, "src", "data", "products.json");
const configPath = join(root, "astro.config.mjs");
const outPath = join(root, "public", "google-merchant.xml");

function siteOrigin() {
  const config = readFileSync(configPath, "utf8");
  const match = config.match(/site:\s*["']([^"']+)["']/);
  return String(match?.[1] || "https://by3dxyz.com").replace(/\/$/, "");
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function productTitle(product) {
  const sku = String(product.sku || "").trim().toUpperCase();
  const name = String(product.name || "").trim();
  if (!sku) return name;
  if (name.toUpperCase().startsWith(sku)) return name;
  if (/^SW-/.test(sku)) return name;
  return `${sku} ${name}`;
}

/** Google Shopping countries that require a shipping rate. US is free via FREE_SHIP_COUNTRIES. */
const SHOPPING_SHIP_COUNTRIES = [
  "AU",
  "AT",
  "BE",
  "BR",
  "CA",
  "CH",
  "CZ",
  "DE",
  "DK",
  "ES",
  "FI",
  "FR",
  "GB",
  "GR",
  "HU",
  "IE",
  "IL",
  "IN",
  "IT",
  "JP",
  "KR",
  "NL",
  "NO",
  "NZ",
  "PL",
  "PT",
  "RO",
  "SE",
  "SK",
  "US",
];

function shippingBlock(country, amount, currency) {
  return [
    "      <g:shipping>",
    `        <g:country>${country}</g:country>`,
    `        <g:price>${amount} ${currency}</g:price>`,
    "      </g:shipping>",
  ].join("\n");
}

function shippingXml(currency) {
  const intl = Number(INTERNATIONAL_SHIPPING_USD).toFixed(2);
  const free = [...FREE_SHIP_COUNTRIES].sort((a, b) => (a === "US" ? -1 : b === "US" ? 1 : a.localeCompare(b)));
  const paid = SHOPPING_SHIP_COUNTRIES.filter((country) => !FREE_SHIP_COUNTRIES.has(country)).sort();
  return [
    ...free.map((country) => shippingBlock(country, "0.00", currency)),
    ...paid.map((country) => shippingBlock(country, intl, currency)),
  ].join("\n");
}

function itemXml(origin, product) {
  const title = productTitle(product);
  const link = `${origin}/tools/${product.slug}`;
  const image = `${origin}${product.images[0]}`;
  const extraImages = (product.images || []).slice(1, 10);
  const price = Number(product.price).toFixed(2);
  const currency = product.currency || "USD";
  const availability = product.inactive ? "out_of_stock" : "in_stock";
  const description = String(product.short || title).trim();
  const extras = extraImages
    .map((src) => `      <g:additional_image_link>${escapeXml(`${origin}${src}`)}</g:additional_image_link>`)
    .join("\n");
  return [
    "    <item>",
    `      <g:id>${escapeXml(product.sku)}</g:id>`,
    `      <g:title>${escapeXml(title)}</g:title>`,
    `      <g:description>${escapeXml(description)}</g:description>`,
    `      <g:link>${escapeXml(link)}</g:link>`,
    `      <g:image_link>${escapeXml(image)}</g:image_link>`,
    extras,
    `      <g:availability>${availability}</g:availability>`,
    `      <g:price>${price} ${currency}</g:price>`,
    "      <g:condition>new</g:condition>",
    "      <g:brand>by3DXYZ</g:brand>",
    `      <g:mpn>${escapeXml(product.sku)}</g:mpn>`,
    "      <g:identifier_exists>false</g:identifier_exists>",
    product.category ? `      <g:product_type>${escapeXml(product.category)}</g:product_type>` : "",
    shippingXml(currency),
    "    </item>",
  ]
    .filter(Boolean)
    .join("\n");
}

export function writeMerchantFeed(products) {
  const origin = siteOrigin();
  const catalog = (products ?? JSON.parse(readFileSync(productsPath, "utf8"))).filter(
    (product) => product?.sku && product?.slug && Array.isArray(product.images) && product.images[0],
  );
  const body = catalog.map((product) => itemXml(origin, product)).join("\n");
  writeFileSync(
    outPath,
    [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">`,
      `  <channel>`,
      `    <title>by3DXYZ</title>`,
      `    <link>${escapeXml(origin)}/</link>`,
      `    <description>Printed parts from by3DXYZ. Same shape every time.</description>`,
      body,
      `  </channel>`,
      `</rss>`,
      "",
    ].join("\n"),
  );
  return catalog.length;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const count = writeMerchantFeed();
  console.log(`Merchant feed: ${count} products → public/google-merchant.xml`);
}
