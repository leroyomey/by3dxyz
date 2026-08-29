import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadVariantSets, money, quoteLines, quotesMatch } from "./checkout-price.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(root, "src", "data");
const catalog = JSON.parse(readFileSync(join(dataDir, "products.json"), "utf8"));
const variantSets = loadVariantSets(
  readdirSync(dataDir)
    .filter((file) => file.endsWith("-variants.json"))
    .map((file) => JSON.parse(readFileSync(join(dataDir, file), "utf8"))),
);

const errors = [];
function ok(cond, msg) {
  if (!cond) errors.push(msg);
}

const rib = quoteLines(catalog, variantSets, [
  { sku: "BO-001", qty: 2, options: { color: "Green", size: "5in/12.7cm" } },
]);
ok(rib[0].unit === 13, "BO-001 5in should be $13");
ok(money(rib[0].unit * rib[0].qty) === "26.00", "BO-001 qty 2 should be $26");

const cheap = quoteLines(catalog, variantSets, [
  { sku: "BO-001", qty: 1, options: { color: "Green", size: "5in/12.7cm" } },
]);
ok(cheap[0].unit !== 1, "Must not accept a $1 unit from the client");

const shaper = quoteLines(catalog, variantSets, [
  { sku: "BO-003", qty: 1, options: { color: "Black" } },
]);
ok(shaper[0].unit === 13.5, "BO-003 should use listing price");

try {
  quoteLines(catalog, variantSets, [
    { sku: "BO-001", qty: 1, options: { color: "White", size: "5in/12.7cm" } },
  ]);
  errors.push("White must be rejected");
} catch {
  /* expected */
}

try {
  quoteLines(catalog, variantSets, [
    { sku: "BO-001", qty: 1, options: { color: "Green", size: "5in/12.7cm" }, unit: 1 },
  ]);
  ok(true, "quote ignores client unit");
} catch (err) {
  errors.push(String(err.message || err));
}
const ignored = quoteLines(catalog, variantSets, [
  { sku: "BO-001", qty: 1, options: { color: "Green", size: "5in/12.7cm" }, unit: 1, total: 1 },
]);
ok(ignored[0].unit === 13, "Client unit:1 must not change the quote");

ok(quotesMatch(rib, rib), "Matching quotes should pass");
ok(!quotesMatch(rib, cheap), "Qty change must fail the quote match");
const cheapPaid = [{ ...rib[0], unit: 1 }];
ok(!quotesMatch(cheapPaid, rib), "A $1 PayPal unit must fail the quote match");

if (errors.length) {
  for (const line of errors) console.error(line);
  process.exitCode = 1;
} else {
  console.log("checkout prices: ok");
}
