import catalog from "./products.json";
import colorVariantSet from "./color-variants.json";
import pickVariantSet from "./pick-variants.json";
import ribVariantSet from "./rib-variants.json";
import decorVariantSet from "./decor-variants.json";

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
  variantSet?: string;
  variants?: VariantGroup[];
  etsyCarts?: number;
  etsyFavorers?: number;
  etsyQuantity?: number;
  etsyStock?: Record<string, number>;
};

const variantSets: Record<string, VariantGroup[]> = {
  rib: ribVariantSet.groups as VariantGroup[],
  color: colorVariantSet.groups as VariantGroup[],
  pick: pickVariantSet.groups as VariantGroup[],
};

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

export const products: Product[] = [...(catalog as Product[])].sort(bySku);

export const categories = [
  "All",
  ...Array.from(new Set(products.map((product) => product.category))).sort(),
];

export function getProduct(slug: string) {
  return products.find((product) => product.slug === slug);
}

export function nextProduct(slug: string) {
  if (!products.length) return undefined;
  const index = products.findIndex((product) => product.slug === slug);
  if (index === -1) return undefined;
  return products[(index + 1) % products.length];
}

export function getBySku(sku: string) {
  return products.find((product) => product.sku.toUpperCase() === sku.toUpperCase());
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

export function productTitle(product: { name: string; sku?: string }) {
  const sku = (product.sku || "").trim().toUpperCase();
  const name = (product.name || "").trim();
  if (!sku) return name;
  if (name.toUpperCase().startsWith(sku)) return name;
  return `${sku} ${name}`;
}

export function etsyCartsTotal(list: Product[] = products) {
  return list.reduce((sum, product) => sum + (Number(product.etsyCarts) || 0), 0);
}

export function etsyFavorersTotal(list: Product[] = products) {
  return list.reduce((sum, product) => sum + (Number(product.etsyFavorers) || 0), 0);
}

export function etsyDemandLabel(
  carts: number | undefined,
  favorers: number | undefined,
  scope: "item" | "shop" = "item",
) {
  const inCarts = Number(carts) || 0;
  const likes = Number(favorers) || 0;
  if (inCarts > 0) {
    if (scope === "shop") {
      return inCarts === 1 ? "1 person has a tool in an Etsy cart." : `${inCarts} people have a tool in an Etsy cart.`;
    }
    return inCarts === 1 ? "In 1 Etsy cart" : `In ${inCarts} Etsy carts`;
  }
  if (likes > 0) {
    if (scope === "shop") {
      return likes === 1 ? "1 favorite on Etsy." : `${likes} favorites on Etsy.`;
    }
    return likes === 1 ? "1 favorite on Etsy" : `${likes} favorites on Etsy`;
  }
  return "";
}

export function etsyStockLabel(quantity: number | undefined) {
  if (typeof quantity !== "number" || !Number.isFinite(quantity)) return "";
  if (quantity <= 0) return "Sold out";
  return quantity === 1 ? "1 in stock" : `${quantity} in stock`;
}

export function displayPrice(product: Product) {
  const priced = productVariants(product)
    .flatMap((group) => group.values.map((value) => value.price))
    .filter((price): price is number => typeof price === "number");
  const min = priced.length ? Math.min(...priced) : product.price;
  const max = priced.length ? Math.max(...priced) : product.price;
  const label = formatPrice(min, product.currency);
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
