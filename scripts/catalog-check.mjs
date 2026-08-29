import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
    if (!/^(BO-\d{3}(-\d+)?|GP-[A-Z]+)$/.test(product.sku)) warn(`${label}: unusual SKU format`);
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

const csvPath = join(root, "catalog", "incoming.csv");
if (existsSync(csvPath)) {
  const header = readFileSync(csvPath, "utf8").split(/\r?\n/)[0] || "";
  if (!header.split(",").includes("variantSet")) {
    err("catalog/incoming.csv header is missing the variantSet column");
  }
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
