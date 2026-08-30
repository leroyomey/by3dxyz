import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, appendFileSync } from "node:fs";
import { dirname, join, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cmdEtsyAuth,
  fetchListingInventory,
  getAccessToken,
  inventoryToStock,
} from "./etsy-oauth.mjs";
import { writeSitemap } from "./sitemap.mjs";
import { writeMerchantFeed } from "./merchant-feed.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const productsPath = join(root, "src", "data", "products.json");
const imagesDir = join(root, "public", "images", "products");
const incomingCsv = join(root, "catalog", "incoming.csv");

function loadEnv() {
  const envPath = join(root, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

function etsyApiKeyHeader() {
  const key = (process.env.ETSY_API_KEY || "").trim();
  const secret = (process.env.ETSY_API_SHARED_SECRET || "").trim();
  if (!key) return "";
  if (key.includes(":")) return key;
  if (secret) return `${key}:${secret}`;
  return key;
}

function loadProducts() {
  return JSON.parse(readFileSync(productsPath, "utf8"));
}

function saveProducts(products) {
  writeFileSync(productsPath, `${JSON.stringify(products, null, 2)}\n`);
  writeSitemap(products);
  writeMerchantFeed(products);
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function listingIdFromUrl(url = "") {
  return url.match(/\/listing\/(\d+)/i)?.[1] ?? "";
}

function skuFromText(text = "") {
  const match = String(text)
    .replace(/<[^>]+>/g, " ")
    .match(/Item\s*#:\s*(BO-\d{3}(?:-\d+)?)/i);
  if (match) return match[1].toUpperCase();
  const tail = String(text).trim().match(/[\(\[](BO-\d{3}(?:-\d+)?)[\)\]]\s*$/i);
  return tail ? tail[1].toUpperCase() : "";
}

function skuFromTitle(title = "") {
  return skuFromText(title);
}

function skuFromListing(item) {
  const title = item.title || "";
  if (isGuitarPick(title)) return pickShopSku(title);
  if (isSpiderWeb(title) || isCoffinShelf(title)) return decorShopSku(title);
  return skuFromTitle(title) || skuFromText(item.description || "");
}

function uniqueSku(wanted, listingId, products) {
  const id = String(listingId);
  const clash = products.find(
    (p) => p.sku && p.sku.toUpperCase() === wanted.toUpperCase() && String(p.etsyListingId) !== id,
  );
  if (!clash) return wanted;
  const prefix = /^SW-/i.test(wanted) ? "SW" : "GP";
  return `${prefix}-${id}`;
}

function nameWithoutSku(title = "") {
  return String(title)
    .replace(/\s*[\(\[]BO-\d{3}(?:-\d+)?[\)\]]\s*$/i, "")
    .trim();
}

function isGuitarPick(title = "") {
  return /guitar\s*pick/i.test(title);
}

function pickShopSku(title = "") {
  if (/griptonite/i.test(title)) return "GP-GRIP";
  if (/plain\s*jane/i.test(title)) return "GP-PLAIN";
  return "";
}

function pickShopName(title = "") {
  if (/plain\s*jane/i.test(title)) return "Plain Jane Guitar Picks";
  if (/griptonite/i.test(title)) return "Griptonite Guitar Picks";
  const pack = String(title).match(/(\d+)\s*pack/i);
  return pack ? `Guitar Picks ${pack[1]} Pack` : "Guitar Picks";
}

function isSpiderWeb(title = "") {
  return /spider\s*web/i.test(title);
}

function isCoffinShelf(title = "") {
  return /coffin\s*shelf/i.test(title);
}

function decorShopSku(title = "") {
  if (isSpiderWeb(title)) return "SW-001";
  if (isCoffinShelf(title)) return "SW-002";
  return "";
}

function decorShopName(title = "") {
  if (isSpiderWeb(title)) return "Spider Web Decor";
  if (isCoffinShelf(title)) return "Coffin Shelf";
  return "";
}

function shopName(title = "") {
  if (isGuitarPick(title)) return pickShopName(title);
  if (isSpiderWeb(title)) return decorShopName(title);
  if (isCoffinShelf(title)) return decorShopName(title);
  const sku = skuFromTitle(title);
  let name = nameWithoutSku(title).replace(/^by3DXYZ\s+/i, "");
  if (/pottery throwing rib/i.test(name) && sku) return "Throwing Rib";
  name = name.replace(/^Pottery Rib & Rim Shaper Tool/i, "Rib & Rim Shaper");
  return name;
}

function isDecor(name = "", extra = {}) {
  const sku = String(extra.sku || "").toUpperCase();
  const category = extra.category || "";
  return /decor/i.test(category) || /decor/i.test(name) || /spider\s*web/i.test(name) || /^SW-/.test(sku);
}

function variantSetFor(name, explicit = "", sku = "") {
  if (explicit) return explicit;
  if (name === "Throwing Rib") return "rib";
  if (/guitar\s*pick/i.test(name)) return "pick";
  if (isCoffinShelf(name) || String(sku).toUpperCase() === "SW-002") return "coffin";
  if (isDecor(name, { sku })) return "decor";
  return "";
}

function categoryFor(name, sku = "") {
  if (/guitar\s*pick/i.test(name)) return "Picks";
  if (isDecor(name, { sku })) return "Decor";
  if (/paddle/i.test(name)) return "Paddles";
  if (/rib/i.test(name)) return "Ribs";
  return "Tools";
}

function plainText(value = "") {
  return String(value)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function listingCopy(item, name, sku) {
  const fromEtsy = plainText(item.description);
  if (name === "Throwing Rib") {
    const short = "Sold separately or as a set of 3. Sizes: 2in through 8in.";
    return { short, description: fromEtsy || short };
  }
  if (/Rim Shaper/i.test(name)) {
    const short = "Shapes rims and compresses clay on the wheel.";
    return { short, description: fromEtsy || short };
  }
  if (/Smooth Surface Paddle/i.test(name)) {
    const short = "A paddle for compressing and smoothing clay.";
    return { short, description: fromEtsy || short };
  }
  if (/Hole Punch Paddle/i.test(name)) {
    const short = "A paddle with holes for lighter paddling and texture.";
    return { short, description: fromEtsy || short };
  }
  if (/guitar\s*pick/i.test(name)) {
    if (/griptonite/i.test(name)) {
      const short = "A 50 pack of textured Griptonite picks, printed in PLA.";
      return {
        short,
        description:
          "A 50 pack of Griptonite guitar picks, 351 style, with a textured face. Choose color and thickness. Printed in PLA.",
      };
    }
    if (/plain\s*jane/i.test(name)) {
      const short = "A 50 pack of Plain Jane picks, printed in PLA.";
      return {
        short,
        description:
          "A 50 pack of Plain Jane guitar picks, 351 style. A simple, reliable pick. Choose color and thickness. Printed in PLA.",
      };
    }
    const short = "A pack of guitar picks, printed in PLA.";
    return { short, description: short };
  }
  if (name === "Coffin Shelf" || String(sku).toUpperCase() === "SW-002") {
    const short = "A 9 inch coffin-shaped shelf, printed in PLA.";
    return {
      short,
      description:
        "A 9 inch coffin-shaped wall shelf, printed in PLA. Choose a color, one or two shelves, and whether you want a back and a hanger.",
    };
  }
  const short = fromEtsy.slice(0, 140) || name;
  return { short, description: fromEtsy || name };
}

function skuBaseNum(sku = "") {
  const match = String(sku).toUpperCase().match(/^BO-(\d+)/);
  return match ? Number(match[1]) : NaN;
}

function nextSku(products) {
  const nums = products.map((p) => skuBaseNum(p.sku)).filter((n) => Number.isFinite(n) && n > 0);
  // BO-053 was used once for decor and is retired. Pottery continues at BO-054.
  const next = Math.max(nums.length ? Math.max(...nums) : 0, 53) + 1;
  return `BO-${String(next).padStart(3, "0")}`;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
    args[key] = value;
  }
  return args;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() && !line.startsWith("#"));
  if (!lines.length) return [];
  const headers = splitCsvRow(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = splitCsvRow(line);
    const row = {};
    headers.forEach((header, i) => {
      row[header.trim()] = (cells[i] ?? "").trim();
    });
    return row;
  });
}

function splitCsvRow(line) {
  const out = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (ch === "," && !quoted) {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}

function existsConflict(products, candidate) {
  const sku = (candidate.sku || "").toUpperCase();
  const listing = candidate.etsyListingId || listingIdFromUrl(candidate.etsyUrl);
  return products.find((p) => {
    if (sku && p.sku?.toUpperCase() === sku) return true;
    if (listing && (p.etsyListingId === listing || listingIdFromUrl(p.etsyUrl) === listing)) return true;
    if (candidate.slug && p.slug === candidate.slug) return true;
    return false;
  });
}

function toProduct(row, products) {
  const rawName = row.name?.trim();
  if (!rawName) throw new Error("name is required");
  const sku = (row.sku?.trim() || skuFromTitle(rawName) || nextSku(products)).toUpperCase();
  const name = nameWithoutSku(rawName);
  const slug = row.slug?.trim() || slugify(name);
  const etsyUrl = row.etsyUrl?.trim() || "https://by3dxyz.etsy.com";
  const etsyListingId = row.etsyListingId?.trim() || listingIdFromUrl(etsyUrl);
  const images = (row.images || "")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    id: slug,
    sku,
    slug,
    name,
    price: Number(row.price),
    currency: row.currency || "USD",
    category: row.category || categoryFor(name, sku),
    short: row.short || name,
    description: row.description || row.short || name,
    images: images.length ? images : [`/images/products/${slug}.svg`],
    etsyUrl,
    etsyListingId,
    paypalUrl: row.paypalUrl || "",
    featured: String(row.featured).toLowerCase() === "true",
    variantSet: variantSetFor(name, row.variantSet, sku),
  };
}

function copyInboxImage(slug, sourcePath) {
  if (!sourcePath || !existsSync(sourcePath)) return "";
  mkdirSync(imagesDir, { recursive: true });
  const ext = extname(sourcePath) || ".jpg";
  const destName = `${slug}${ext}`;
  const dest = join(imagesDir, destName);
  copyFileSync(sourcePath, dest);
  return `/images/products/${destName}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseEtsyCartCount(html) {
  if (!html) return 0;
  const patterns = [
    /\bIn\s+([\d,]+)\s+carts?\b/i,
    /([\d,]+)\s+people have this in their carts?/i,
    /"inCartCount"\s*:\s*(\d+)/i,
    /"type"\s*:\s*"CARTS"[\s\S]{0,48}"count"\s*:\s*(\d+)/,
    /"count"\s*:\s*(\d+)[\s\S]{0,48}"type"\s*:\s*"CARTS"/,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match) continue;
    const n = Number(String(match[1]).replace(/,/g, ""));
    if (Number.isFinite(n) && n >= 0 && n < 100000) return n;
  }
  return 0;
}

async function fetchEtsyCartCount(listingId) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`https://www.etsy.com/listing/${listingId}`, {
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9",
        referer: "https://www.etsy.com/shop/by3dxyz",
      },
      redirect: "follow",
    });
    if (!res.ok) return null;
    return parseEtsyCartCount(await res.text());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function refreshEtsyCarts(products) {
  let changed = 0;
  let failed = 0;
  for (const product of products) {
    const id = product.etsyListingId || listingIdFromUrl(product.etsyUrl);
    if (!id) continue;
    const count = await fetchEtsyCartCount(id);
    if (count == null) {
      failed += 1;
      await sleep(400);
      continue;
    }
    if (product.etsyCarts !== count) changed += 1;
    product.etsyCarts = count;
    await sleep(400);
  }
  const total = products.reduce((sum, product) => sum + (Number(product.etsyCarts) || 0), 0);
  return { changed, failed, total };
}

function listedAtFromListing(item) {
  const unix = item?.original_creation_timestamp ?? item?.created_timestamp;
  const n = typeof unix === "number" ? unix : typeof unix === "string" && /^\d+$/.test(unix) ? Number(unix) : NaN;
  if (!Number.isFinite(n) || n <= 0) return "";
  return new Date(n * 1000).toISOString();
}

function applyListedAt(products, listings) {
  const byId = new Map(listings.map((item) => [String(item.listing_id), item]));
  let filled = 0;
  for (const product of products) {
    const item = byId.get(String(product.etsyListingId || listingIdFromUrl(product.etsyUrl)));
    if (!item) continue;
    const iso = listedAtFromListing(item);
    if (!iso || product.listedAt === iso) continue;
    product.listedAt = iso;
    filled += 1;
  }
  return filled;
}

function applyEtsyDemand(products, listings) {
  const byId = new Map(listings.map((item) => [String(item.listing_id), item]));
  let favorers = 0;
  let stock = 0;
  for (const product of products) {
    const item = byId.get(String(product.etsyListingId || listingIdFromUrl(product.etsyUrl)));
    if (!item) continue;
    if (typeof item.num_favorers === "number") product.etsyFavorers = item.num_favorers;
    if (typeof item.quantity === "number") product.etsyQuantity = item.quantity;
    const apiCart = item.num_in_carts ?? item.in_carts ?? item.inCartCount;
    if (typeof apiCart === "number") product.etsyCarts = apiCart;
    favorers += Number(product.etsyFavorers) || 0;
    stock += Number(product.etsyQuantity) || 0;
  }
  return { favorers, stock };
}

async function refreshEtsyInventory(products) {
  const token = await getAccessToken();
  if (!token) {
    return { linked: false, updated: 0, failed: 0 };
  }
  const apiKey = etsyApiKeyHeader();
  let updated = 0;
  let failed = 0;
  for (const product of products) {
    const id = product.etsyListingId || listingIdFromUrl(product.etsyUrl);
    if (!id) continue;
    const inventory = await fetchListingInventory(id, token, apiKey);
    if (!inventory) {
      failed += 1;
      await sleep(200);
      continue;
    }
    const stock = inventoryToStock(inventory);
    product.etsyStock = stock;
    updated += 1;
    await sleep(200);
  }
  return { linked: true, updated, failed };
}

function etsyHeaders(apiKey) {
  return { "x-api-key": apiKey };
}

async function fetchEtsyListings(apiKey, shopName) {
  const shopRes = await fetch(
    `https://openapi.etsy.com/v3/application/shops?shop_name=${encodeURIComponent(shopName)}`,
    { headers: etsyHeaders(apiKey) },
  );
  if (!shopRes.ok) {
    throw new Error(`Etsy shop lookup failed: ${shopRes.status} ${await shopRes.text()}`);
  }
  const shopId = (await shopRes.json()).results?.[0]?.shop_id;
  if (!shopId) throw new Error(`No shop found for ${shopName}`);
  const listings = [];
  let offset = 0;
  while (true) {
    const listRes = await fetch(
      `https://openapi.etsy.com/v3/application/shops/${shopId}/listings/active?limit=100&offset=${offset}`,
      { headers: etsyHeaders(apiKey) },
    );
    if (!listRes.ok) {
      throw new Error(`Etsy listings failed: ${listRes.status} ${await listRes.text()}`);
    }
    const listJson = await listRes.json();
    listings.push(...(listJson.results ?? []));
    if (listings.length >= (listJson.count ?? 0) || !(listJson.results ?? []).length) break;
    offset += 100;
  }
  return listings;
}

function listingImageDest(slug, i) {
  const destName = i === 0 ? `${slug}.jpg` : `${slug}-${i + 1}.jpg`;
  return { destName, rel: `/images/products/${destName}`, abs: join(imagesDir, destName) };
}

async function fetchListingImageRows(listingId, apiKey) {
  const res = await fetch(
    `https://openapi.etsy.com/v3/application/listings/${listingId}/images`,
    { headers: etsyHeaders(apiKey) },
  );
  if (!res.ok) return null;
  return ((await res.json()).results ?? []).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
}

async function writeListingImage(slug, i, url) {
  const { rel, abs } = listingImageDest(slug, i);
  const imgRes = await fetch(url);
  if (!imgRes.ok) return "";
  writeFileSync(abs, Buffer.from(await imgRes.arrayBuffer()));
  return rel;
}

async function downloadListingImages(listingId, slug, apiKey) {
  const rows = await fetchListingImageRows(listingId, apiKey);
  if (!rows?.length) return [];
  mkdirSync(imagesDir, { recursive: true });
  const paths = [];
  // Do not cap at 2 or prefer url_570xN: that left galleries short and coffin/SW photos soft.
  for (const [i, img] of rows.entries()) {
    const url = img.url_fullxfull || img.url_570xN;
    if (!url) continue;
    const written = await writeListingImage(slug, i, url);
    if (written) paths.push(written);
  }
  return paths;
}

function listingImagesOnDisk(product, etsyCount) {
  const have = new Set(product.images || []);
  for (let i = 0; i < etsyCount; i++) {
    const { rel, abs } = listingImageDest(product.slug, i);
    if (!have.has(rel) || !existsSync(abs)) return false;
  }
  return true;
}

async function fillMissingProductImages(product, apiKey) {
  const listingId = product.etsyListingId || listingIdFromUrl(product.etsyUrl);
  if (!listingId) return { status: "skip" };
  const rows = await fetchListingImageRows(listingId, apiKey);
  if (rows == null) return { status: "fail" };
  if (!rows.length) return { status: "empty" };
  if (listingImagesOnDisk(product, rows.length)) return { status: "ok", added: 0 };
  mkdirSync(imagesDir, { recursive: true });
  const paths = [];
  let added = 0;
  for (const [i, img] of rows.entries()) {
    const { rel, abs } = listingImageDest(product.slug, i);
    if (!existsSync(abs)) {
      const url = img.url_fullxfull || img.url_570xN;
      if (!url) continue;
      const written = await writeListingImage(product.slug, i, url);
      if (!written) continue;
      paths.push(written);
      added += 1;
      continue;
    }
    paths.push(rel);
  }
  if (paths.length) product.images = paths;
  return { status: added ? "added" : "wired", added, count: paths.length };
}

async function fillMissingListingImages(products, apiKey) {
  let photos = 0;
  let listings = 0;
  let failed = 0;
  for (const product of products) {
    const result = await fillMissingProductImages(product, apiKey);
    if (result.status === "fail" || result.status === "empty") failed += 1;
    if (result.status === "added" || result.status === "wired") {
      listings += 1;
      photos += result.added || 0;
    }
  }
  return { photos, listings, failed };
}

async function cmdImagesSync() {
  loadEnv();
  const apiKey = etsyApiKeyHeader();
  if (!apiKey || !apiKey.includes(":")) {
    console.error("Set ETSY_API_KEY and ETSY_API_SHARED_SECRET in .env");
    process.exitCode = 1;
    return;
  }
  const products = loadProducts();
  let gained = 0;
  let synced = 0;
  const failed = [];
  for (const product of products) {
    const listingId = product.etsyListingId || listingIdFromUrl(product.etsyUrl);
    if (!listingId) {
      failed.push(`${product.sku}: no Etsy listing id`);
      continue;
    }
    const before = Array.isArray(product.images) ? product.images.length : 0;
    const images = await downloadListingImages(listingId, product.slug, apiKey);
    if (!images.length) {
      failed.push(`${product.sku}: Etsy images empty or request failed (${listingId})`);
      continue;
    }
    product.images = images;
    synced += 1;
    if (images.length > before) gained += 1;
    console.log(`${String(product.sku).padEnd(10)}  site:${before} → ${images.length}`);
  }
  saveProducts(products);
  console.log(`\nSynced ${synced} listings. Gained photos: ${gained}. Could not sync: ${failed.length}`);
  for (const line of failed) console.log(line);
}

function sortCatalog(products) {
  return products.sort((a, b) => {
    const am = String(a.sku || "").toUpperCase().match(/^BO-(\d+)(?:-(\d+))?$/);
    const bm = String(b.sku || "").toUpperCase().match(/^BO-(\d+)(?:-(\d+))?$/);
    const a1 = am ? Number(am[1]) : 9999;
    const a2 = am ? Number(am[2] || 0) : 0;
    const b1 = bm ? Number(bm[1]) : 9999;
    const b2 = bm ? Number(bm[2] || 0) : 0;
    return a1 - b1 || a2 - b2 || String(a.sku).localeCompare(String(b.sku));
  });
}

function cmdList() {
  const products = loadProducts();
  console.log(`${products.length} tools\n`);
  for (const p of products) {
    const listing = p.etsyListingId || listingIdFromUrl(p.etsyUrl) || "no-listing";
    console.log(`${p.sku.padEnd(10)}  ${p.slug.padEnd(24)}  $${p.price}  etsy:${listing}`);
  }
  console.log(`\nNext SKU: ${nextSku(products)}`);
}

function cmdAdd(args) {
  const products = loadProducts();
  const product = toProduct(args, products);
  if (args.image) {
    const copied = copyInboxImage(product.slug, args.image);
    if (copied) product.images = [copied];
  }
  const clash = existsConflict(products, product);
  if (clash) {
    console.error(`Already on site: ${clash.sku} (${clash.name})`);
    process.exitCode = 1;
    return;
  }
  if (!Number.isFinite(product.price)) {
    console.error("price must be a number");
    process.exitCode = 1;
    return;
  }
  products.push(product);
  saveProducts(products);
  console.log(`Added ${product.sku} ${product.name}`);
}

function cmdImport(filePath = incomingCsv) {
  if (!existsSync(filePath)) {
    console.error(`No CSV at ${filePath}`);
    process.exitCode = 1;
    return;
  }
  const products = loadProducts();
  const rows = parseCsv(readFileSync(filePath, "utf8"));
  let added = 0;
  let linked = 0;
  let skipped = 0;
  for (const row of rows) {
    const product = toProduct(row, products);
    const clash = existsConflict(products, product);
    if (clash) {
      if (product.etsyListingId && clash.sku === product.sku && !clash.etsyListingId) {
        clash.etsyListingId = product.etsyListingId;
        clash.etsyUrl = product.etsyUrl;
        console.log(`Link ${clash.sku} → listing ${product.etsyListingId}`);
        linked += 1;
        continue;
      }
      if (
        product.sku &&
        !clash.sku &&
        product.etsyListingId &&
        (clash.etsyListingId === product.etsyListingId || listingIdFromUrl(clash.etsyUrl) === product.etsyListingId)
      ) {
        clash.sku = product.sku;
        clash.name = product.name || clash.name;
        clash.category = product.category || clash.category;
        clash.variantSet = product.variantSet || clash.variantSet;
        clash.short = product.short || clash.short;
        clash.description = product.description || clash.description;
        if (Number.isFinite(product.price)) clash.price = product.price;
        console.log(`Link listing ${product.etsyListingId} → ${clash.sku}`);
        linked += 1;
        continue;
      }
      console.log(`Skip ${product.name} — already ${clash.sku}`);
      skipped += 1;
      continue;
    }
    products.push(product);
    added += 1;
    console.log(`Add ${product.sku} ${product.name}`);
  }
  saveProducts(products);
  console.log(`\nDone. added ${added}, linked ${linked}, skipped ${skipped}`);
}

async function listingToProduct(item, apiKey, featured, existing = []) {
  const id = String(item.listing_id);
  const sku = uniqueSku(
    skuFromListing(item) ||
      (isGuitarPick(item.title) ? `GP-${id}` : isSpiderWeb(item.title) ? `SW-${id}` : ""),
    id,
    existing,
  );
  const name = shopName(item.title || "Untitled");
  const slug = sku ? slugify(`${name} ${sku}`) : slugify(name);
  const { short, description } = listingCopy(item, name, sku);
  const images = await downloadListingImages(id, slug, apiKey);
  const listedAt = listedAtFromListing(item);
  return {
    id: slug,
    sku,
    slug,
    name,
    price: (item.price?.amount ?? 0) / (item.price?.divisor || 100),
    currency: item.price?.currency_code || "USD",
    category: categoryFor(name, sku),
    short,
    description,
    images: images.length ? images : [`/images/products/${slug}.jpg`],
    etsyUrl: `https://www.etsy.com/listing/${id}`,
    etsyListingId: id,
    paypalUrl: "",
    featured,
    variantSet: variantSetFor(name, isGuitarPick(item.title) ? "pick" : "", sku),
    etsyQuantity: typeof item.quantity === "number" ? item.quantity : undefined,
    ...(listedAt ? { listedAt } : {}),
  };
}

async function cmdEtsyDiff(replace = false) {
  loadEnv();
  const apiKey = etsyApiKeyHeader();
  const etsyShop = process.env.ETSY_SHOP_NAME || "by3dxyz";
  if (!apiKey) {
    console.error("Set ETSY_API_KEY in .env (Etsy Developers keystring).");
    process.exitCode = 1;
    return;
  }
  if (!apiKey.includes(":")) {
    console.error("Etsy also needs the shared secret. Add ETSY_API_SHARED_SECRET to .env");
    process.exitCode = 1;
    return;
  }
  let listings;
  try {
    listings = await fetchEtsyListings(apiKey, etsyShop);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
    return;
  }
  const usable = listings;

  if (replace) {
    const featuredNames = new Set([
      "Throwing Rib",
      "Rib & Rim Shaper (Small)",
      "Rib & Rim Shaper (Large)",
      "Smooth Surface Paddle",
      "Hole Punch Paddle",
    ]);
    const products = [];
    for (const item of usable) {
      const name = shopName(item.title || "");
      const sku = skuFromListing(item);
      const featured =
        (name === "Throwing Rib" && sku === "BO-001") ||
        (name !== "Throwing Rib" && featuredNames.has(name));
      const product = await listingToProduct(item, apiKey, featured, products);
      products.push(product);
      console.log(`Add ${product.sku || "—"}  ${product.name}`);
    }
    saveProducts(sortCatalog(products));
    console.log(`\nEtsy active: ${listings.length}`);
    console.log(`On website now: ${products.length}`);
    return;
  }

  const products = loadProducts();
  const knownListings = new Set(
    products.flatMap((p) => [p.etsyListingId, listingIdFromUrl(p.etsyUrl)].filter(Boolean)),
  );
  const bySku = new Map(products.filter((p) => p.sku).map((p) => [p.sku.toUpperCase(), p]));
  const missing = [];
  for (const item of usable) {
    const id = String(item.listing_id);
    const sku = skuFromListing(item);
    if (knownListings.has(id) || (sku && bySku.has(sku))) continue;
    missing.push(item);
  }
  console.log(`Etsy active: ${listings.length}`);
  console.log(`On website: ${products.length}`);
  console.log(`New listings (not on site): ${missing.length}\n`);
  for (const item of missing) {
    const price = (item.price?.amount ?? 0) / (item.price?.divisor || 100);
    const sku = skuFromListing(item) || "(no BO code)";
    console.log(`${sku}  $${price}  ${shopName(item.title)}`);
    console.log(`  https://www.etsy.com/listing/${item.listing_id}`);
  }
  if (missing.length) {
    mkdirSync(join(root, "catalog"), { recursive: true });
    const header = "sku,name,price,category,short,description,etsyUrl,etsyListingId,images,featured";
    const rows = missing.map((item) => {
      const price = ((item.price?.amount ?? 0) / (item.price?.divisor || 100)).toFixed(2);
      const sku = skuFromListing(item);
      const name = shopName(item.title || "Untitled").replaceAll('"', '""');
      const url = `https://www.etsy.com/listing/${item.listing_id}`;
      return `${sku},"${name}",${price},${categoryFor(name, sku)},"${name}","${name}",${url},${item.listing_id},,false`;
    });
    const out = join(root, "catalog", "etsy-new.csv");
    writeFileSync(out, `${header}\n${rows.join("\n")}\n`);
    console.log(`\nWrote ${out} — review, then: npm run catalog:import -- catalog/etsy-new.csv`);
  }
}

function appendSyncLog(lines) {
  mkdirSync(join(root, "catalog"), { recursive: true });
  const stamp = new Date().toISOString();
  appendFileSync(join(root, "catalog", "sync.log"), `\n=== ${stamp} ===\n${lines.join("\n")}\n`);
}

function findExisting(products, item) {
  const id = String(item.listing_id);
  const sku = skuFromListing(item);
  return products.find((p) => {
    if (p.etsyListingId === id || listingIdFromUrl(p.etsyUrl) === id) return true;
    if (sku && p.sku && p.sku.toUpperCase() === sku) return true;
    return false;
  });
}

async function cmdEtsySync() {
  loadEnv();
  const apiKey = etsyApiKeyHeader();
  const etsyShop = process.env.ETSY_SHOP_NAME || "by3dxyz";
  if (!apiKey || !apiKey.includes(":")) {
    console.error("Set ETSY_API_KEY and ETSY_API_SHARED_SECRET in .env");
    process.exitCode = 1;
    return;
  }
  let listings;
  try {
    listings = await fetchEtsyListings(apiKey, etsyShop);
  } catch (err) {
    console.error(err.message);
    appendSyncLog([err.message]);
    process.exitCode = 1;
    return;
  }
  const usable = listings;
  const activeIds = new Set(usable.map((item) => String(item.listing_id)));
  let products = loadProducts();
  let added = 0;
  let updated = 0;
  let hidden = 0;
  let restored = 0;
  const notes = [];

  for (const product of products) {
    if (!product.etsyListingId) continue;
    const active = activeIds.has(String(product.etsyListingId));
    if (!active && !product.inactive) {
      product.inactive = true;
      hidden += 1;
      notes.push(`Hide ${product.sku || product.name} (not in Etsy active)`);
    } else if (active && product.inactive) {
      delete product.inactive;
      restored += 1;
      notes.push(`Show ${product.sku || product.name} (back on Etsy)`);
    }
  }

  for (const item of usable) {
    const existing = findExisting(products, item);
    const price = (item.price?.amount ?? 0) / (item.price?.divisor || 100);
    const sku = skuFromListing(item);
    const name = shopName(item.title || "Untitled");
    if (existing) {
      let changed = false;
      if (name && existing.name !== name) {
        existing.name = name;
        changed = true;
      }
      if (existing.price !== price) {
        existing.price = price;
        changed = true;
      }
      if (sku && !existing.sku) {
        existing.sku = sku;
        changed = true;
      }
      if (!existing.etsyListingId) {
        existing.etsyListingId = String(item.listing_id);
        existing.etsyUrl = `https://www.etsy.com/listing/${item.listing_id}`;
        changed = true;
      }
      if (typeof item.quantity === "number" && existing.etsyQuantity !== item.quantity) {
        existing.etsyQuantity = item.quantity;
        changed = true;
      }
      const listedAt = listedAtFromListing(item);
      if (listedAt && existing.listedAt !== listedAt) {
        existing.listedAt = listedAt;
        changed = true;
      }
      if (changed) {
        updated += 1;
        notes.push(`Update ${existing.sku || name}`);
      }
      continue;
    }
    const product = await listingToProduct(item, apiKey, false, products);
    products.push(product);
    added += 1;
    notes.push(`Add ${product.sku || "—"}  ${product.name}`);
  }

  const carts = await refreshEtsyCarts(products);
  const demand = applyEtsyDemand(products, usable);
  const listed = applyListedAt(products, usable);
  const inventory = await refreshEtsyInventory(products);
  notes.push(`Etsy carts: ${carts.total} (updated ${carts.changed}, failed ${carts.failed})`);
  notes.push(`Etsy favorites: ${demand.favorers}`);
  notes.push(`Etsy stock: ${demand.stock}`);
  notes.push(`Listing dates: ${listed}`);
  if (inventory.linked) {
    notes.push(`Etsy option stock: ${inventory.updated} listings (failed ${inventory.failed})`);
  } else {
    notes.push("Etsy option stock: skipped (run npm run catalog:auth once)");
  }
  const photos = await fillMissingListingImages(products, apiKey);
  notes.push(`Etsy photos: ${photos.photos} new on ${photos.listings} listings (failed ${photos.failed})`);

  saveProducts(sortCatalog(products));
  const summary = [
    `Etsy active: ${listings.length}`,
    `Added: ${added}`,
    `Updated: ${updated}`,
    `Hidden: ${hidden}`,
    `Restored: ${restored}`,
    `On website: ${products.length}`,
    ...notes,
  ];
  appendSyncLog(summary);
  for (const line of summary) console.log(line);
}

const [command, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);

async function cmdListedAt() {
  loadEnv();
  const apiKey = etsyApiKeyHeader();
  const etsyShop = process.env.ETSY_SHOP_NAME || "by3dxyz";
  if (!apiKey || !apiKey.includes(":")) {
    console.error("Set ETSY_API_KEY and ETSY_API_SHARED_SECRET in .env");
    process.exitCode = 1;
    return;
  }
  let listings;
  try {
    listings = await fetchEtsyListings(apiKey, etsyShop);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
    return;
  }
  const products = loadProducts();
  const filled = applyListedAt(products, listings);
  saveProducts(products);
  console.log(`Etsy active: ${listings.length}`);
  console.log(`Listing dates written: ${filled}`);
}

if (command === "list") cmdList();
else if (command === "add") cmdAdd(args);
else if (command === "import") cmdImport(rest[0] || incomingCsv);
else if (command === "etsy-diff") {
  if (args.replace === "true" && args["yes-replace"] !== "true") {
    console.error("Refusing catalog replace. That rebuilds the site catalog from Etsy and drops unlinked rows.");
    console.error("If you mean it: npm run catalog:etsy -- --replace --yes-replace");
    process.exitCode = 1;
  } else {
    await cmdEtsyDiff(args.replace === "true");
  }
}
else if (command === "etsy-sync") await cmdEtsySync();
else if (command === "images-sync") await cmdImagesSync();
else if (command === "listed-at") await cmdListedAt();
else if (command === "etsy-auth") {
  loadEnv();
  await cmdEtsyAuth();
}
else if (command === "apply-variants") {
  const products = loadProducts();
  let n = 0;
  for (const product of products) {
    if (product.name === "Throwing Rib") {
      product.variantSet = "rib";
      n += 1;
    } else if (/guitar\s*pick/i.test(product.name)) {
      product.variantSet = "pick";
    } else if (isCoffinShelf(product.name) || String(product.sku).toUpperCase() === "SW-002") {
      product.variantSet = "coffin";
    } else if (isDecor(product.name, { sku: product.sku, category: product.category })) {
      product.variantSet = "decor";
    } else if (!product.variantSet) {
      product.variantSet = "";
    }
  }
  saveProducts(products);
  console.log(`Rib color/size options on ${n} throwing ribs`);
}
else {
  console.log(`by3DXYZ catalog

  npm run catalog:list
  npm run catalog:add -- --name "Coil Gauge [BO-009]" --price 14 --category "Coil tools" --etsyUrl "https://www.etsy.com/listing/123"
  npm run catalog:import
  npm run catalog:etsy
  npm run catalog:etsy -- --replace --yes-replace
  npm run catalog:sync
  npm run catalog:images
  npm run catalog:listed-at
  npm run catalog:auth

Identity is SKU (BO-001) from (BO-001) or [BO-001] at the end of the Etsy title, plus listing ID.
`);
}
