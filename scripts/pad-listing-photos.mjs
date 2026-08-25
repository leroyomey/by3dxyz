/**
 * Straighten + pad Etsy listing photos.
 * Reads facebook copies first, then public/images/products.
 * Writes only to _private/etsy/listing-photos/. Does not touch the site.
 */
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const facebookDir = join(root, "_private", "facebook");
const productsDir = join(root, "public", "images", "products");
const outDir = join(root, "_private", "etsy", "listing-photos");

const OUT_SIZE = 2000;
const MARGIN = 0.12;
const SKIP_DEG = 1.4;
const MAX_DEG = 4;
const CHANNELS = 3;

function luma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function idx(x, y, w) {
  return (y * w + x) * CHANNELS;
}

function cornerBg(data, w, h) {
  const pts = [
    [4, 4],
    [w - 5, 4],
    [4, h - 5],
    [w - 5, h - 5],
  ];
  let r = 0;
  let g = 0;
  let b = 0;
  for (const [x, y] of pts) {
    const i = idx(x, y, w);
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  return {
    r: Math.round(r / pts.length),
    g: Math.round(g / pts.length),
    b: Math.round(b / pts.length),
  };
}

function sampleBg(data, w, h, box, mask) {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  if (box) {
    const band = 14;
    const x0 = Math.max(0, box.minX - band);
    const y0 = Math.max(0, box.minY - band);
    const x1 = Math.min(w - 1, box.maxX + band);
    const y1 = Math.min(h - 1, box.maxY + band);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY) continue;
        if (mask?.[y * w + x]) continue;
        const i = idx(x, y, w);
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        n += 1;
      }
    }
  }
  if (n < 20) return cornerBg(data, w, h);
  return {
    r: Math.round(r / n),
    g: Math.round(g / n),
    b: Math.round(b / n),
  };
}

function toolMask(data, w, h, bg) {
  const bgL = luma(bg.r, bg.g, bg.b);
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = idx(x, y, w);
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const L = luma(r, g, b);
      const dist = Math.abs(r - bg.r) + Math.abs(g - bg.g) + Math.abs(b - bg.b);
      if (L < bgL - 32 || (dist > 90 && L < bgL - 8)) mask[y * w + x] = 1;
    }
  }
  return mask;
}

function largestComponent(mask, w, h) {
  const seen = new Uint8Array(w * h);
  let best = [];
  const stack = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || seen[i]) continue;
    stack.length = 0;
    stack.push(i);
    seen[i] = 1;
    const cells = [];
    while (stack.length) {
      const p = stack.pop();
      cells.push(p);
      const x = p % w;
      const y = (p - x) / w;
      const neigh = [
        p - 1,
        p + 1,
        p - w,
        p + w,
      ];
      for (const n of neigh) {
        if (n < 0 || n >= mask.length || seen[n] || !mask[n]) continue;
        const nx = n % w;
        if (Math.abs(nx - x) + Math.abs(((n - nx) / w) - y) !== 1) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
    if (cells.length > best.length) best = cells;
  }
  const out = new Uint8Array(w * h);
  for (const p of best) out[p] = 1;
  return { mask: out, count: best.length };
}

function bboxOf(mask, w, h) {
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  let n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      n += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!n) return null;
  return { minX, minY, maxX, maxY, w: maxX - minX + 1, h: maxY - minY + 1, n };
}

function pcaAxis(mask, w, h) {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      sx += x;
      sy += y;
      n += 1;
    }
  }
  if (n < 50) return null;
  const cx = sx / n;
  const cy = sy / n;
  let xx = 0;
  let xy = 0;
  let yy = 0;
  const step = n > 8000 ? 2 : 1;
  let used = 0;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      if (!mask[y * w + x]) continue;
      const dx = x - cx;
      const dy = y - cy;
      xx += dx * dx;
      xy += dx * dy;
      yy += dy * dy;
      used += 1;
    }
  }
  const tr = xx + yy;
  const det = xx * yy - xy * xy;
  const disc = Math.max(0, tr * tr / 4 - det);
  const l1 = tr / 2 + Math.sqrt(disc);
  const l2 = tr / 2 - Math.sqrt(disc);
  let vx = l1 - yy;
  let vy = xy;
  if (Math.abs(vx) + Math.abs(vy) < 1e-9) {
    vx = xy;
    vy = l1 - xx;
  }
  const mag = Math.hypot(vx, vy) || 1;
  const ecc = l2 > 1 ? l1 / l2 : 99;
  return { angle: Math.atan2(vy / mag, vx / mag), ecc, cx, cy, used };
}

function wrapPi(a) {
  while (a <= -Math.PI) a += 2 * Math.PI;
  while (a > Math.PI) a -= 2 * Math.PI;
  return a;
}

function lineAlignDelta(axis, target) {
  let d = wrapPi(axis - target);
  if (d > Math.PI / 2) d -= Math.PI;
  if (d < -Math.PI / 2) d += Math.PI;
  return d;
}

function toDeg(rad) {
  return (rad * 180) / Math.PI;
}

function findHoles(mask, data, w, h, bg) {
  const bgL = luma(bg.r, bg.g, bg.b);
  const outside = new Uint8Array(w * h);
  const stack = [];
  const push = (x, y) => {
    const p = y * w + x;
    if (outside[p] || mask[p]) return;
    const i = idx(x, y, w);
    const L = luma(data[i], data[i + 1], data[i + 2]);
    if (L < bgL - 20) return;
    outside[p] = 1;
    stack.push(p);
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }
  while (stack.length) {
    const p = stack.pop();
    const x = p % w;
    const y = (p - x) / w;
    if (x > 0) push(x - 1, y);
    if (x + 1 < w) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y + 1 < h) push(x, y + 1);
  }
  const hole = new Uint8Array(w * h);
  for (let p = 0; p < hole.length; p++) {
    if (mask[p] || outside[p]) continue;
    const x = p % w;
    const y = (p - x) / w;
    const i = idx(x, y, w);
    const L = luma(data[i], data[i + 1], data[i + 2]);
    if (L >= bgL - 25) hole[p] = 1;
  }
  const seen = new Uint8Array(w * h);
  const blobs = [];
  for (let i = 0; i < hole.length; i++) {
    if (!hole[i] || seen[i]) continue;
    const cells = [];
    const st = [i];
    seen[i] = 1;
    let sx = 0;
    let sy = 0;
    let minX = w;
    let minY = h;
    let maxX = 0;
    let maxY = 0;
    while (st.length) {
      const p = st.pop();
      cells.push(p);
      const x = p % w;
      const y = (p - x) / w;
      sx += x;
      sy += y;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      for (const n of [p - 1, p + 1, p - w, p + w]) {
        if (n < 0 || n >= hole.length || seen[n] || !hole[n]) continue;
        const nx = n % w;
        if (Math.abs(nx - x) + Math.abs(((n - nx) / w) - y) !== 1) continue;
        seen[n] = 1;
        st.push(n);
      }
    }
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    const area = cells.length;
    const aspect = bw / bh;
    if (area < 40 || area > 12000) continue;
    if (aspect < 0.45 || aspect > 2.2) continue;
    blobs.push({
      x: sx / cells.length,
      y: sy / cells.length,
      area,
    });
  }
  blobs.sort((a, b) => b.area - a.area);
  return blobs.slice(0, 4);
}

function holeRowAngle(holes) {
  if (holes.length < 2) return null;
  const pts = holes.slice(0, 3).sort((a, b) => a.y - b.y);
  const a = pts[0];
  const b = pts[pts.length - 1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.hypot(dx, dy) < 8) return null;
  return Math.atan2(dx, dy);
}

async function rawFrom(input) {
  const { data, info } = await sharp(input)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

function analyze(data, w, h) {
  const maskBg = cornerBg(data, w, h);
  const rawMask = toolMask(data, w, h, maskBg);
  const { mask, count } = largestComponent(rawMask, w, h);
  const box = bboxOf(mask, w, h);
  if (!box || count < 200) return { bg: maskBg, mask: null, box: null, holes: [], pca: null };
  return {
    bg: sampleBg(data, w, h, box, mask),
    mask,
    box,
    holes: findHoles(mask, data, w, h, maskBg),
    pca: pcaAxis(mask, w, h),
  };
}

function decideRotation(sku, box, holes, pca) {
  if (/BO-019/.test(sku)) {
    return { deg: 0, method: "skip-paddle", reason: "handheld paddle" };
  }
  const aspect = box.w / box.h;
  const roundish = aspect > 0.82 && aspect < 1.22;
  if (roundish) {
    return { deg: 0, method: "skip-round", reason: "round tool" };
  }

  const holeAng = holes.length >= 3 ? holeRowAngle(holes) : null;
  if (holeAng == null) {
    return { deg: 0, method: "skip-round", reason: "no hole row" };
  }
  const deg = toDeg(holeAng);
  if (Math.abs(deg) < SKIP_DEG) return { deg: 0, method: "holes", reason: "already straight" };
  if (Math.abs(deg) > MAX_DEG) return { deg: 0, method: "holes", reason: `unsafe ${deg.toFixed(2)}deg` };
  return { deg, method: "holes", reason: "rotated" };
}

async function placeOnSquare(input, box, bg, srcW, srcH, fitWhole) {
  const fit = fitWhole ? Math.max(srcW, srcH) : Math.max(box.w, box.h);
  const scale = (OUT_SIZE * (1 - 2 * MARGIN)) / fit;
  const newW = Math.max(1, Math.round(srcW * scale));
  const newH = Math.max(1, Math.round(srcH * scale));
  const cx = fitWhole ? srcW / 2 : (box.minX + box.maxX + 1) / 2;
  const cy = fitWhole ? srcH / 2 : (box.minY + box.maxY + 1) / 2;
  const left = Math.round(OUT_SIZE / 2 - cx * scale);
  const top = Math.round(OUT_SIZE / 2 - cy * scale);
  const resized = await sharp(input).resize(newW, newH).toBuffer();
  const srcLeft = Math.max(0, -left);
  const srcTop = Math.max(0, -top);
  const dstLeft = Math.max(0, left);
  const dstTop = Math.max(0, top);
  const width = Math.min(newW - srcLeft, OUT_SIZE - dstLeft);
  const height = Math.min(newH - srcTop, OUT_SIZE - dstTop);
  const piece = await sharp(resized)
    .extract({ left: srcLeft, top: srcTop, width, height })
    .toBuffer();
  return sharp({
    create: {
      width: OUT_SIZE,
      height: OUT_SIZE,
      channels: 3,
      background: bg,
    },
  })
    .composite([{ input: piece, left: dstLeft, top: dstTop }])
    .jpeg({ quality: 90, mozjpeg: true });
}

function skuFromFacebook(name) {
  return name.match(/^(BO-\d{3}(?:-\d+)?)/i)?.[1]?.toUpperCase() ?? "";
}

function skuFromProduct(name) {
  const m = name.match(/bo-(\d{3}(?:-\d+)?)/i);
  if (m) return `BO-${m[1].toUpperCase()}`;
  if (/rib-rim-shaper-small/i.test(name)) return "BO-003";
  if (/rib-rim-shaper-large/i.test(name)) return "BO-020";
  if (/smooth-surface-paddle/i.test(name)) return "BO-019-1";
  if (/hole-punch-paddle/i.test(name)) return "BO-019-2";
  return "";
}

function collectSources() {
  const map = new Map();
  for (const name of readdirSync(productsDir)) {
    if (!/\.jpe?g$/i.test(name) || /guitar|pick/i.test(name)) continue;
    const sku = skuFromProduct(name);
    if (sku) map.set(sku, join(productsDir, name));
  }
  for (const name of readdirSync(facebookDir)) {
    if (!/\.jpe?g$/i.test(name) || /guitar|pick/i.test(name)) continue;
    const sku = skuFromFacebook(name);
    if (sku) map.set(sku, join(facebookDir, name));
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
}

async function processOne(sku, src) {
  const first = await rawFrom(src);
  const a1 = analyze(first.data, first.w, first.h);
  if (!a1.box) return { sku, src, ok: false, error: "no tool mask" };

  const rot = decideRotation(sku, a1.box, a1.holes, a1.pca);
  let working = src;
  let bg = a1.bg;
  if (rot.deg) {
    working = await sharp(src)
      .rotate(rot.deg, { background: bg })
      .jpeg({ quality: 95 })
      .toBuffer();
  }

  const second = rot.deg ? await rawFrom(working) : first;
  const a2 = rot.deg ? analyze(second.data, second.w, second.h) : a1;
  if (!a2.box) return { sku, src, ok: false, error: "no tool after rotate", rot };
  bg = a2.bg;

  const dest = join(outDir, `${sku}.jpg`);
  await (await placeOnSquare(working, a2.box, bg, second.w, second.h, /BO-019/.test(sku))).toFile(dest);

  return {
    sku,
    src: basename(src),
    ok: true,
    dest,
    rotDeg: rot.deg,
    method: rot.method,
    reason: rot.reason,
    holes: a1.holes.length,
  };
}

mkdirSync(outDir, { recursive: true });
const sources = collectSources();
const rows = [];
for (const [sku, src] of sources) {
  try {
    const row = await processOne(sku, src);
    rows.push(row);
    const mark = row.ok ? (row.rotDeg ? `rot ${row.rotDeg.toFixed(2)}` : row.reason) : row.error;
    console.log(`${sku}  ${mark}  ${basename(src)}`);
  } catch (err) {
    rows.push({ sku, src, ok: false, error: err.message });
    console.error(`${sku}  FAIL  ${err.message}`);
  }
}

const ok = rows.filter((r) => r.ok);
const rotated = ok.filter((r) => r.rotDeg);
const left = ok.filter((r) => !r.rotDeg);
const failed = rows.filter((r) => !r.ok);
const log = [
  `listing photos ${new Date().toISOString().slice(0, 16)}`,
  `written: ${ok.length}`,
  `rotated: ${rotated.length}`,
  `left at 0: ${left.length}`,
  `failed: ${failed.length}`,
  `output: ${outDir}`,
  "",
  ...rows.map((r) =>
    r.ok
      ? `${r.sku}  ${r.rotDeg ? `${r.rotDeg.toFixed(2)}deg ${r.method}` : r.reason}  holes=${r.holes}  from ${r.src}`
      : `${r.sku}  FAIL  ${r.error}`,
  ),
].join("\n");
writeFileSync(join(outDir, "log.txt"), `${log}\n`);
console.log(`\n${log.split("\n").slice(0, 6).join("\n")}`);
