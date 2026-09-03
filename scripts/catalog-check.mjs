import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { INTERNATIONAL_SHIPPING_USD } from "./checkout-price.mjs";
import { groupsFromInventory, isWhiteColor, syncVariantData } from "./etsy-variants.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(root, "src", "data");
const publicDir = join(root, "public");

const errors = [];
const warnings = [];
const err = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);

const products = JSON.parse(readFileSync(join(dataDir, "products.json"), "utf8"));

const variantSets = new Map();
for (const file of readdirSync(dataDir).filter((f) => f.endsWith("-variants.json"))) {
  const set = JSON.parse(readFileSync(join(dataDir, file), "utf8"));
  if (!set.id) {
    err(`${file} has no "id"`);
    continue;
  }
  if (!Array.isArray(set.groups) || !set.groups.length) err(`${file} has no groups`);
  if (variantSets.has(set.id)) err(`Two variant files claim id "${set.id}"`);
  variantSets.set(set.id, { file, set });

  for (const group of set.groups || []) {
    if (!group.id) err(`${file} has a group with no id`);
    if (!group.label) err(`${file} group "${group.id}" has no label`);
    if (!group.placeholder) err(`${file} group "${group.id}" has no placeholder`);
    if (!Array.isArray(group.values) || !group.values.length) {
      err(`${file} group "${group.id}" has no values`);
    }
    for (const value of group.values || []) {
      if (!value?.name) err(`${file} group "${group.id}" has a value with no name`);
      if (/^white$/i.test(value?.name || "")) err(`${file} offers White. White is not a shop color.`);
    }
  }
}

const seenSku = new Map();
const seenSlug = new Map();

for (const product of products) {
  const label = product.sku || product.slug || product.name || "(unnamed)";

  if (!product.sku) {
    err(`${label}: no SKU`);
  } else {
    if (!/^(BO-\d{3}(-\d+)?|SW-\d{3}|GP-[A-Z]+)$/.test(product.sku)) warn(`${label}: unusual SKU format`);
    if (seenSku.has(product.sku)) err(`Duplicate SKU ${product.sku}`);
    seenSku.set(product.sku, true);
  }

  if (!product.slug) err(`${label}: no slug`);
  else if (seenSlug.has(product.slug)) err(`Duplicate slug ${product.slug}`);
  seenSlug.set(product.slug, true);

  if (!product.name) err(`${label}: no name`);
  if (/plain\s*jane/i.test(String(product.sku || "") + String(product.name || "")) && /griptonite/i.test(product.name || "")) {
    err(`${label}: Plain Jane must not say Griptonite`);
  }
  if (/guitar\s*pick/i.test(product.name || "") && /50\s*pack|351\s*style|multiple\s*sizes/i.test(product.name || "")) {
    err(`${label}: pick name must stay short (not the Etsy title)`);
  }
  if (!product.category) err(`${label}: no category`);
  if (!(Number(product.price) > 0)) err(`${label}: price is ${product.price}`);

  if (!Array.isArray(product.images) || !product.images.length) {
    err(`${label}: no images`);
  } else {
    for (const image of product.images) {
      if (!existsSync(join(publicDir, image.replace(/^\//, "")))) {
        err(`${label}: image not on disk ${image}`);
      }
    }
  }

  if (product.variantSet) {
    if (!variantSets.has(product.variantSet)) {
      err(`${label}: variantSet "${product.variantSet}" has no ${product.variantSet}-variants.json`);
    }
    if (String(product.sku).toUpperCase() === "SW-002" && product.variantSet !== "coffin") {
      err(`${label}: coffin shelf must use variantSet coffin, not ${product.variantSet}`);
    }
    if (String(product.sku).toUpperCase() === "SW-002") {
      const groups = variantSets.get(product.variantSet)?.set?.groups || [];
      const extra = groups.flatMap((group) => (group.values || []).map((value) => String(value.name || "")));
      if (extra.some((name) => /2in\/|set of 3|2 pack|4 pack|6 pack/i.test(name))) {
        err(`${label}: coffin shelf must not offer rib sizes or spider-web packs`);
      }
      const styles = groups.find((group) => group.id === "style")?.values || [];
      const styleNames = styles.map((value) => String(value.name || ""));
      if (!styleNames.some((name) => /top shelf/i.test(name))) {
        err(`${label}: coffin shelf must offer the Etsy Top Shelf style`);
      }
      if (!styleNames.some((name) => /low shelf/i.test(name))) {
        err(`${label}: coffin shelf must offer the Etsy Low Shelf style`);
      }
      if (!styleNames.some((name) => /^2 shelves$/i.test(name))) {
        err(`${label}: coffin shelf must offer 2 Shelves`);
      }
    }
  } else {
    warn(`${label}: no variantSet, so the page has no color dropdown`);
  }

  if (!product.etsyListingId) warn(`${label}: not linked to an Etsy listing`);

  if (product.listedAt != null && product.listedAt !== "") {
    const raw = product.listedAt;
    const date =
      typeof raw === "number"
        ? new Date(raw < 1e12 ? raw * 1000 : raw)
        : /^\d+$/.test(String(raw))
          ? new Date(Number(raw) < 1e12 ? Number(raw) * 1000 : Number(raw))
          : new Date(raw);
    if (Number.isNaN(date.getTime())) err(`${label}: listedAt is not a date`);
  }

  for (const field of ["short", "description"]) {
    if (String(product[field] || "").includes("—")) {
      warn(`${label}: em dash in ${field}. Customer copy uses a period, comma, or hyphen.`);
    }
  }
}

const feedPath = join(publicDir, "google-merchant.xml");
if (!existsSync(feedPath)) {
  err("public/google-merchant.xml is missing. Run npm run merchant:feed");
} else {
  const feed = readFileSync(feedPath, "utf8");
  if (!feed.includes("<g:identifier_exists>false</g:identifier_exists>")) {
    err("Merchant feed must set identifier_exists false");
  }
  if (!feed.includes("<g:country>US</g:country>") || !/<g:shipping>[\s\S]*?<g:country>US<\/g:country>[\s\S]*?<g:price>0\.00 USD<\/g:price>/.test(feed)) {
    err("Merchant feed must list US shipping at $0");
  }
  const intl = Number(INTERNATIONAL_SHIPPING_USD).toFixed(2);
  if (!feed.includes(`<g:price>${intl} USD</g:price>`)) {
    err(`Merchant feed must list international shipping at $${intl}`);
  }
  const decorTitle = feed.match(/<g:id>SW-001<\/g:id>\s*<g:title>([^<]+)<\/g:title>/)?.[1];
  if (decorTitle && decorTitle !== "Spider Web Decor") {
    err(`SW-001 merchant title must stay Spider Web Decor (got ${decorTitle})`);
  }
  const coffinTitle = feed.match(/<g:id>SW-002<\/g:id>\s*<g:title>([^<]+)<\/g:title>/)?.[1];
  if (coffinTitle && coffinTitle !== "Coffin Shelf") {
    err(`SW-002 merchant title must stay Coffin Shelf (got ${coffinTitle})`);
  }
}

const csvPath = join(root, "catalog", "incoming.csv");
if (existsSync(csvPath)) {
  const header = readFileSync(csvPath, "utf8").split(/\r?\n/)[0] || "";
  if (!header.split(",").includes("variantSet")) {
    err("catalog/incoming.csv header is missing the variantSet column");
  }
}

const coffinLive = groupsFromInventory({
  products: [
    {
      property_values: [
        { property_name: "Primary color", values: ["Green"] },
        { property_name: "Shelf Style", values: ["1  Shelf - Top Shelf"] },
        { property_name: "Back / Hanger", values: ["No Back / No Hanger"] },
      ],
      offerings: [{ price: { amount: 3499, divisor: 100 }, is_enabled: true }],
    },
    {
      property_values: [
        { property_name: "Primary color", values: ["White"] },
        { property_name: "Shelf Style", values: ["1 Shelf - Low Shelf"] },
        { property_name: "Back / Hanger", values: ["Back / Hanger"] },
      ],
      offerings: [{ price: { amount: 3499, divisor: 100 }, is_enabled: true }],
    },
    {
      property_values: [
        { property_name: "Primary color", values: ["Green"] },
        { property_name: "Shelf Style", values: ["2 Shelves"] },
        { property_name: "Back / Hanger", values: ["Back / Hanger"] },
      ],
      offerings: [{ price: { amount: 4299, divisor: 100 }, is_enabled: true }],
    },
  ],
});
const coffinStyle = coffinLive.find((group) => group.id === "style");
if (!coffinStyle?.values.some((row) => row.name === "1 Shelf - Top Shelf" && row.price === 34.99)) {
  err("Live Etsy inventory must map Top Shelf at $34.99");
}
if (!coffinStyle?.values.some((row) => row.name === "1 Shelf - Low Shelf")) {
  err("Live Etsy inventory must collapse Top/Low shelf names");
}
if (coffinLive.some((group) => (group.values || []).some((row) => isWhiteColor(row.name)))) {
  err("Live Etsy inventory must drop White");
}
const synced = syncVariantData({
  products: [{ sku: "SW-002", etsyListingId: "1", variantSet: "coffin" }],
  inventories: new Map([
    [
      "1",
      {
        products: [
          {
            property_values: [
              { property_name: "Primary color", values: ["Green"] },
              { property_name: "Shelf Style", values: ["1 Shelf - Top Shelf"] },
              { property_name: "Back / Hanger", values: ["No Back / No Hanger"] },
            ],
            offerings: [{ price: { amount: 3499, divisor: 100 }, is_enabled: true }],
          },
          {
            property_values: [
              { property_name: "Primary color", values: ["Green"] },
              { property_name: "Shelf Style", values: ["1 Shelf - Low Shelf"] },
              { property_name: "Back / Hanger", values: ["No Back / No Hanger"] },
            ],
            offerings: [{ price: { amount: 3499, divisor: 100 }, is_enabled: true }],
          },
        ],
      },
    ],
  ]),
  variantFiles: {
    coffin: {
      id: "coffin",
      groups: [{ id: "style", label: "Shelf style", placeholder: "Select a shelf style", values: [{ name: "1 Shelf", price: 34.99 }] }],
    },
  },
});
if (!synced.changedFileIds.includes("coffin")) {
  err("catalog:sync must rewrite coffin-variants.json when Etsy adds a shelf style");
}
const syncedStyles = synced.variantFiles.coffin.groups.find((group) => group.id === "style")?.values || [];
if (syncedStyles.some((row) => row.name === "1 Shelf") || !syncedStyles.some((row) => row.name === "1 Shelf - Top Shelf")) {
  err("catalog:sync must replace stale 1 Shelf with the live Top/Low names");
}

console.log(`Checked ${products.length} products and ${variantSets.size} variant sets.`);
console.log(`Variant sets: ${[...variantSets.keys()].sort().join(", ")}`);

if (warnings.length) {
  console.log(`\nWarnings (${warnings.length}):`);
  for (const line of warnings) console.log(`  - ${line}`);
}

if (errors.length) {
  console.log(`\nErrors (${errors.length}):`);
  for (const line of errors) console.log(`  - ${line}`);
  process.exitCode = 1;
} else {
  console.log("\nNo errors.");
}
