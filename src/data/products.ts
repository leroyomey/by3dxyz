import catalog from "./products.json";

export type VariantValue = {
  name: string;
  price?: number;
};

export type VariantGroup = {
  id: string;
  label: string;
  placeholder: string;
  values: VariantValue[];
};

export type Product = {
  id: string;
  sku: string;
  slug: string;
  name: string;
  price: number;
  currency: string;
  category: string;
  short: string;
  description: string;
  images: string[];
  etsyUrl: string;
  etsyListingId: string;
  paypalUrl: string;
  featured: boolean;
  listedAt?: string;
  variantSet?: string;
  variants?: VariantGroup[];
  etsyCarts?: number;
  etsyFavorers?: number;
  etsyQuantity?: number;
  etsyStock?: Record<string, number>;
  inactive?: boolean;
};

type VariantFile = { id: string; groups: VariantGroup[] };

// Drop a new `<name>-variants.json` in this folder and its "id" becomes a
// usable variantSet. No edit here is needed to add one.
const variantFiles = import.meta.glob("./*-variants.json", { eager: true }) as Record<
  string,
  VariantFile | { default: VariantFile }
>;

const variantSets: Record<string, VariantGroup[]> = Object.fromEntries(
  Object.values(variantFiles)
    .map((mod) => ("default" in mod ? mod.default : mod))
    .filter((set) => set?.id && Array.isArray(set.groups))
    .map((set) => [set.id, set.groups]),
);

export function skuSortKey(sku: string) {
  const match = String(sku).toUpperCase().match(/^BO-(\d+)(?:-(\d+))?$/);
  if (!match) return [9999, 0] as const;
  return [Number(match[1]), Number(match[2] || 0)] as const;
}

export function bySku(a: { sku: string }, b: { sku: string }) {
  const aa = skuSortKey(a.sku);
  const bb = skuSortKey(b.sku);
  return aa[0] - bb[0] || aa[1] - bb[1] || a.sku.localeCompare(b.sku);
}

export const allProducts: Product[] = [...(catalog as Product[])].sort(bySku);
export const products: Product[] = allProducts.filter((product) => !product.inactive);

export type ProductFamily = "rim-shaper" | "paddle" | "throwing-rib" | "pick" | "decor" | "other";

export const shopFilters: { id: string; label: string }[] = [
  { id: "all", label: "All" },
  { id: "featured", label: "Featured" },
  { id: "rim-shaper", label: "Rim shapers" },
  { id: "paddle", label: "Paddles" },
  { id: "throwing-rib", label: "Ribs" },
  { id: "pick", label: "Picks" },
  { id: "decor", label: "Decor" },
];

export function productFamily(product: { sku: string; category?: string; name?: string }): ProductFamily {
  const sku = (product.sku || "").toUpperCase();
  if (sku === "BO-003" || sku === "BO-020") return "rim-shaper";
  if (sku === "BO-019-1" || sku === "BO-019-2" || /paddle/i.test(product.category || "")) return "paddle";
  if (/^GP-/.test(sku) || /pick/i.test(product.category || "") || /pick/i.test(product.name || "")) return "pick";
  if (/^SW-/.test(sku) || /decor/i.test(product.category || "") || /decor/i.test(product.name || "")) return "decor";
  if (product.category === "Ribs" || /throwing rib/i.test(product.name || "")) return "throwing-rib";
  return "other";
}

export function cardShort(product: Product) {
  if (productFamily(product) === "throwing-rib") return "2 to 8 in, or a set of 3.";
  return product.short;
}

export function relatedProducts(product: Product, count = 3) {
  const family = productFamily(product);
  const [base] = skuSortKey(product.sku);
  return products
    .filter((item) => item.sku !== product.sku && productFamily(item) === family)
    .sort((a, b) => {
      const da = Math.abs(skuSortKey(a.sku)[0] - base);
      const db = Math.abs(skuSortKey(b.sku)[0] - base);
      return da - db || bySku(a, b);
    })
    .slice(0, count);
}

export function getProduct(slug: string) {
  return allProducts.find((product) => product.slug === slug);
}

export function nextProduct(slug: string) {
  const index = allProducts.findIndex((product) => product.slug === slug);
  if (index === -1) return undefined;
  return allProducts.slice(index + 1).find((product) => !product.inactive);
}

export function prevProduct(slug: string) {
  const index = allProducts.findIndex((product) => product.slug === slug);
  if (index <= 0) return undefined;
  return allProducts
    .slice(0, index)
    .reverse()
    .find((product) => !product.inactive);
}

export function getBySku(sku: string) {
  return allProducts.find((product) => product.sku.toUpperCase() === sku.toUpperCase());
}

export function featuredProducts() {
  return products.filter((product) => product.featured);
}

export function productVariants(product: Product): VariantGroup[] {
  if (product.variants?.length) return product.variants;
  if (product.variantSet && variantSets[product.variantSet]) return variantSets[product.variantSet];
  return [];
}

export function formatPrice(price: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(price);
}

export function productCopy(description: string) {
  return description.replace(/\s*Item\s*#:\s*[A-Z0-9-]+\s*$/i, "").trim();
}

/** Split a catalog blob into readable About paragraphs. Does not rewrite the source. */
export function aboutParagraphs(description: string) {
  const text = productCopy(description);
  if (!text) return [];
  const blocks = text
    .split(/\n\s*\n/)
    .map((block) => block.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return blocks.flatMap((block) => {
    const parts = block.split(/(?<=[.!?])\s+(?=[A-Z])/).map((part) => part.trim()).filter(Boolean);
    return parts.length ? parts : [block];
  });
}

export function productTitle(product: { name: string; sku?: string }) {
  const sku = (product.sku || "").trim().toUpperCase();
  const name = (product.name || "").trim();
  if (!sku) return name;
  if (name.toUpperCase().startsWith(sku)) return name;
  if (/^SW-/.test(sku)) return name;
  return `${sku} ${name}`;
}

export function etsyCartsTotal(list: Product[] = products) {
  return list.reduce((sum, product) => sum + (Number(product.etsyCarts) || 0), 0);
}

export function etsyFavorersTotal(list: Product[] = products) {
  return list.reduce((sum, product) => sum + (Number(product.etsyFavorers) || 0), 0);
}

export function etsyDemandLabel(
  _carts: number | undefined,
  favorers: number | undefined,
  scope: "item" | "shop" = "item",
) {
  const likes = Number(favorers) || 0;
  if (likes > 0) {
    if (scope === "shop") {
      return likes === 1 ? "1 favorite on Etsy." : `${likes} favorites on Etsy.`;
    }
    return likes === 1 ? "1 favorite on Etsy" : `${likes} favorites on Etsy`;
  }
  return "";
}

export function etsyStockLabel(_quantity: number | undefined, inactive = false) {
  if (inactive) return "Not available";
  return "Made to order";
}

export function productPriceBounds(product: Product) {
  const priced = productVariants(product)
    .flatMap((group) => group.values.map((value) => value.price))
    .filter((price): price is number => typeof price === "number");
  const min = priced.length ? Math.min(...priced) : product.price;
  const max = priced.length ? Math.max(...priced) : product.price;
  return { min, max, currency: product.currency || "USD" };
}

export function displayPrice(product: Product) {
  const { min, max, currency } = productPriceBounds(product);
  const label = formatPrice(min, currency);
  return max > min ? `${label}+` : label;
}

export function listingIdFromEtsyUrl(url: string) {
  const match = url.match(/\/listing\/(\d+)/i);
  return match?.[1] ?? "";
}

export function skuFromTitle(title: string) {
  const match = title.trim().match(/[\(\[](BO-\d{3}(?:-\d+)?)[\)\]]\s*$/i);
  return match ? match[1].toUpperCase() : "";
}

export function nameWithoutSku(title: string) {
  return title.replace(/\s*[\(\[]BO-\d{3}(?:-\d+)?[\)\]]\s*$/i, "").trim();
}
