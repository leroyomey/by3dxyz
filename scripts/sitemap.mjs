/**
 * Write public/sitemap.xml from astro.config site URL + pottery catalog.
 * Skips /thanks (post-checkout) and /callback (Etsy OAuth).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const productsPath = join(root, "src", "data", "products.json");
const configPath = join(root, "astro.config.mjs");
const outPath = join(root, "public", "sitemap.xml");

const staticPaths = ["/", "/tools", "/custom", "/about", "/contact", "/privacy"];

function siteOrigin() {
  const config = readFileSync(configPath, "utf8");
  const match = config.match(/site:\s*["']([^"']+)["']/);
  return String(match?.[1] || "https://by3dxyz.com").replace(/\/$/, "");
}

function locFor(origin, path) {
  if (path === "/") return `${origin}/`;
  return `${origin}${path}`;
}

function escapeXml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function writeSitemap(products) {
  const origin = siteOrigin();
  const catalog = products ?? JSON.parse(readFileSync(productsPath, "utf8"));
  const locs = [
    ...staticPaths.map((path) => locFor(origin, path)),
    ...catalog
      .filter((product) => product?.slug)
      .map((product) => locFor(origin, `/tools/${product.slug}`)),
  ];
  const body = locs.map((loc) => `  <url>\n    <loc>${escapeXml(loc)}</loc>\n  </url>`).join("\n");
  writeFileSync(
    outPath,
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`,
  );
  return locs.length;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const count = writeSitemap();
  console.log(`Sitemap: ${count} URLs → public/sitemap.xml`);
}
