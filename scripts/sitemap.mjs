/**
 * Write public/sitemap.xml from astro.config site URL + catalog.
 * Includes print, custom, shop, and every product (ribs, paddles, picks).
 * Skips /thanks (post-checkout, noindex) and /callback (Etsy OAuth, noindex).
 */
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const productsPath = join(root, "src", "data", "products.json");
const configPath = join(root, "astro.config.mjs");
const outPath = join(root, "public", "sitemap.xml");

const staticPages = [
  { path: "/", file: "src/pages/index.astro", changefreq: "weekly", priority: "1.0" },
  { path: "/print", file: "src/pages/print.astro", changefreq: "weekly", priority: "0.9" },
  { path: "/custom", file: "src/pages/custom.astro", changefreq: "weekly", priority: "0.9" },
  { path: "/tools", file: "src/pages/tools/index.astro", changefreq: "weekly", priority: "0.8" },
  { path: "/about", file: "src/pages/about.astro", changefreq: "monthly", priority: "0.5" },
  { path: "/contact", file: "src/pages/contact.astro", changefreq: "monthly", priority: "0.5" },
  { path: "/privacy", file: "src/pages/privacy.astro", changefreq: "yearly", priority: "0.3" },
];

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

function lastmodFor(filePath) {
  try {
    return new Date(statSync(filePath).mtimeMs).toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function urlBlock({ loc, lastmod, changefreq, priority }) {
  return [
    "  <url>",
    `    <loc>${escapeXml(loc)}</loc>`,
    `    <lastmod>${lastmod}</lastmod>`,
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority}</priority>`,
    "  </url>",
  ].join("\n");
}

export function writeSitemap(products) {
  const origin = siteOrigin();
  const catalog = products ?? JSON.parse(readFileSync(productsPath, "utf8"));
  const catalogStamp = lastmodFor(productsPath);
  const entries = [
    ...staticPages.map((page) => ({
      loc: locFor(origin, page.path),
      lastmod: lastmodFor(join(root, page.file)),
      changefreq: page.changefreq,
      priority: page.priority,
    })),
    ...catalog
      .filter((product) => product?.slug)
      .map((product) => ({
        loc: locFor(origin, `/tools/${product.slug}`),
        lastmod: catalogStamp,
        changefreq: "monthly",
        priority: "0.6",
      })),
  ];
  writeFileSync(
    outPath,
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.map(urlBlock).join("\n")}\n</urlset>\n`,
  );
  return entries.map((entry) => entry.loc);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const locs = writeSitemap();
  console.log(`Sitemap: ${locs.length} URLs → public/sitemap.xml`);
}
