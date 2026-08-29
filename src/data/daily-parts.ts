export const DAILY_PARTS_COUNT = 12;
export const DAILY_FEATURED_COUNT = 4;

export type DailyPart = {
  id: string;
  sku: string;
  slug: string;
  name: string;
  image: string;
  featured?: boolean;
  listedAt?: string;
};

export function utcDayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function hashSeed(key: string): number {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number) {
  return function next() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(list: T[], rng: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function pickDailyParts<T extends { id: string; featured?: boolean }>(
  items: T[],
  date = new Date(),
): T[] {
  if (items.length <= DAILY_PARTS_COUNT) return [...items];
  const rng = mulberry32(hashSeed(utcDayKey(date)));
  const featured = shuffle(
    items.filter((item) => item.featured),
    rng,
  );
  const rest = shuffle(
    items.filter((item) => !item.featured),
    rng,
  );
  const featuredTake = Math.min(DAILY_FEATURED_COUNT, featured.length, DAILY_PARTS_COUNT);
  const picked = [
    ...featured.slice(0, featuredTake),
    ...rest.slice(0, DAILY_PARTS_COUNT - featuredTake),
  ];
  if (picked.length < DAILY_PARTS_COUNT) {
    const used = new Set(picked.map((item) => item.id));
    for (const item of shuffle(items, rng)) {
      if (used.has(item.id)) continue;
      picked.push(item);
      used.add(item.id);
      if (picked.length >= DAILY_PARTS_COUNT) break;
    }
  }
  return shuffle(picked, rng);
}
