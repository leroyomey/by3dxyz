/**
 * Make 1200×1200 JPEGs for Facebook/link previews.
 * Listing photos are ~570px; comment cards often skip anything under 600px.
 */
import { mkdirSync, readdirSync } from "node:fs";
import { join, extname, basename } from "node:path";
import sharp from "sharp";

const size = 1200;
const srcDir = join("public", "images", "products");
const destDir = join("public", "images", "share");
const bg = "#0b0a10";

mkdirSync(destDir, { recursive: true });

const files = readdirSync(srcDir).filter((name) => /\.jpe?g$/i.test(name));
for (const name of files) {
  const dest = join(destDir, `${basename(name, extname(name))}.jpg`);
  await sharp(join(srcDir, name))
    .resize(size, size, { fit: "contain", background: bg })
    .jpeg({ quality: 85, mozjpeg: true })
    .toFile(dest);
}

console.log(`Share images: ${files.length} at ${size}×${size} in ${destDir}`);
