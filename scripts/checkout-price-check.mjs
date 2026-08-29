import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  INTERNATIONAL_SHIPPING_USD,
  loadVariantSets,
  money,
  orderTotal,
  purchaseUnit,
  quoteLines,
  quotesMatch,
  shippingAmount,
} from "./checkout-price.mjs";

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

ok(shippingAmount("US") === 0, "USA shipping must be free");
ok(shippingAmount("us") === 0, "USA country code is case-insensitive");
ok(shippingAmount("PR") === 0, "US territories stay free");
ok(shippingAmount("CA") === INTERNATIONAL_SHIPPING_USD, "Canada pays the international flat");
ok(shippingAmount("GB") === INTERNATIONAL_SHIPPING_USD, "Other countries pay the international flat");
try {
  shippingAmount("");
  errors.push("Empty country must not get free shipping");
} catch {
  /* fail closed */
}
ok(INTERNATIONAL_SHIPPING_USD === 18, "International flat stays in one config number");
const usaUnit = purchaseUnit(cheap, "USD", shippingAmount("US"));
ok(usaUnit.amount.breakdown.shipping.value === "0.00", "USA PayPal shipping must be 0.00");
ok(usaUnit.amount.value === "13.00", "USA total is items only");
const caUnit = purchaseUnit(cheap, "USD", shippingAmount("CA"));
ok(caUnit.amount.breakdown.shipping.value === "18.00", "Canada PayPal shipping is the flat");
ok(caUnit.amount.value === "31.00", "Canada total is items plus shipping");
ok(caUnit.amount.breakdown.item_total.value === "13.00", "Shipping is not hidden in the item price");
ok(orderTotal(cheap, 0) === 13, "orderTotal US");
ok(money(orderTotal(cheap, INTERNATIONAL_SHIPPING_USD)) === "31.00", "orderTotal CA");

if (errors.length) {
  for (const line of errors) console.error(line);
  process.exitCode = 1;
} else {
  console.log("checkout prices: ok");
}
