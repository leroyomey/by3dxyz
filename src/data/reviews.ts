import catalog from "./reviews.json";

export type ReviewSourceId = "etsy";

export type EtsyReview = {
  rating: number;
  text: string;
  source: ReviewSourceId | string;
  created?: string;
  buyerName?: string;
};

/** Add a row here when a new shop origin is used (shopify, amazon, …). */
export const REVIEW_SOURCE_LABELS: Record<string, string> = {
  etsy: "Etsy",
};

const bySku = catalog as Record<string, EtsyReview[]>;

export function reviewsForSku(sku: string): EtsyReview[] {
  return bySku[(sku || "").toUpperCase()] ?? [];
}

export function sourceLabel(source?: string) {
  const id = (source || "").trim().toLowerCase();
  if (!id) return "";
  return REVIEW_SOURCE_LABELS[id] || source!.trim();
}

export function sourceHref(source: string | undefined, hrefs: Record<string, string | undefined>) {
  const id = (source || "").trim().toLowerCase();
  return (id && hrefs[id]) || "";
}

export function formatReviewDate(iso?: string) {
  if (!iso) return "";
  const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function starLabel(rating: number) {
  return `${rating} out of 5`;
}
