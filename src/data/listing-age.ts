export const NEW_LISTING_DAYS = 14;

export function parseListedAt(value: string | number | null | undefined): Date | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return null;
    const date = new Date(value < 1e12 ? value * 1000 : value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    const date = new Date(n < 1e12 ? n * 1000 : n);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isNewListing(value: string | number | null | undefined, now = new Date()): boolean {
  const listed = parseListedAt(value);
  if (!listed) return false;
  const listedDay = Date.UTC(listed.getUTCFullYear(), listed.getUTCMonth(), listed.getUTCDate());
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = (today - listedDay) / 86400000;
  return days >= 0 && days < NEW_LISTING_DAYS;
}
