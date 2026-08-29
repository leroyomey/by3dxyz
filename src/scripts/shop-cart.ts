export const CART_KEY = "by3dxyz-cart";
export const CART_EVENT = "by3dxyz-cart";
export const CART_QTY_MAX = 10;

export type CartLine = {
  sku: string;
  name: string;
  href: string;
  qty: number;
  unit: number;
  currency: string;
  options: Record<string, string>;
  optionLine: string;
};

export type BuyState = {
  line: CartLine;
  ready: boolean;
};

function clampQty(value: number): number {
  const qty = Math.floor(Number(value) || 0);
  if (qty < 1) return 0;
  return Math.min(CART_QTY_MAX, qty);
}

export function lineKey(line: Pick<CartLine, "sku" | "options">): string {
  const opts = Object.entries(line.options)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("|");
  return [line.sku, opts].filter(Boolean).join("|");
}

function asLine(raw: unknown): CartLine | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Partial<CartLine>;
  const sku = String(row.sku || "").trim().toUpperCase();
  const name = String(row.name || "").trim();
  const qty = clampQty(Number(row.qty));
  const unit = Number(row.unit);
  const currency = String(row.currency || "USD");
  const options =
    row.options && typeof row.options === "object" && !Array.isArray(row.options)
      ? Object.fromEntries(
          Object.entries(row.options).map(([key, value]) => [key, String(value)]),
        )
      : {};
  if (!sku || !name || !qty || !Number.isFinite(unit) || unit <= 0) return null;
  return {
    sku,
    name,
    href: String(row.href || ""),
    qty,
    unit,
    currency,
    options,
    optionLine: String(row.optionLine || ""),
  };
}

export function loadCart(): CartLine[] {
  try {
    const raw = sessionStorage.getItem(CART_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const rows = Array.isArray(parsed) ? parsed : parsed?.lines;
    if (!Array.isArray(rows)) return [];
    return rows.map(asLine).filter((line): line is CartLine => Boolean(line));
  } catch {
    return [];
  }
}

export function saveCart(lines: CartLine[]): CartLine[] {
  const next = lines
    .map(asLine)
    .filter((line): line is CartLine => Boolean(line));
  try {
    sessionStorage.setItem(CART_KEY, JSON.stringify(next));
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new Event(CART_EVENT));
  return next;
}

export function addToCart(incoming: CartLine): CartLine[] {
  const line = asLine(incoming);
  if (!line) return loadCart();
  const key = lineKey(line);
  const lines = loadCart();
  const index = lines.findIndex((row) => lineKey(row) === key);
  if (index >= 0) {
    lines[index] = {
      ...lines[index],
      ...line,
      qty: clampQty(lines[index].qty + line.qty) || CART_QTY_MAX,
    };
  } else {
    lines.push(line);
  }
  return saveCart(lines);
}

export function setLineQty(key: string, qty: number): CartLine[] {
  const next = clampQty(qty);
  const lines = loadCart().filter((line) => {
    if (lineKey(line) !== key) return true;
    return next > 0;
  });
  const index = lines.findIndex((line) => lineKey(line) === key);
  if (index >= 0 && next > 0) lines[index] = { ...lines[index], qty: next };
  return saveCart(lines);
}

export function removeLine(key: string): CartLine[] {
  return saveCart(loadCart().filter((line) => lineKey(line) !== key));
}

export function clearCart(): CartLine[] {
  return saveCart([]);
}

export function cartCount(lines = loadCart()): number {
  return lines.reduce((sum, line) => sum + line.qty, 0);
}

export function cartTotal(lines = loadCart()): number {
  return lines.reduce((sum, line) => sum + line.unit * line.qty, 0);
}

export function readBuyState(root: Element): BuyState {
  const name = root.getAttribute("data-name") || "by3DXYZ part";
  const sku = (root.getAttribute("data-sku") || "").toUpperCase();
  const href = root.getAttribute("data-href") || "";
  const currency = root.getAttribute("data-currency") || "USD";
  const base = Number(root.getAttribute("data-base-price") || "0");
  const qty = clampQty(Number((root.querySelector("[data-qty]") as HTMLSelectElement | null)?.value)) || 1;
  const selects = [...root.querySelectorAll("select[data-option]")];
  const options: Record<string, string> = {};
  const parts: string[] = [];
  let unit = Number.isFinite(base) ? base : 0;
  let ready = true;
  for (const select of selects) {
    if (!(select instanceof HTMLSelectElement)) continue;
    const id = select.getAttribute("data-option") || "option";
    const label = select.getAttribute("data-option-label") || id;
    if (!select.value) {
      ready = false;
      continue;
    }
    const priced = Number(select.selectedOptions[0]?.getAttribute("data-price") || "");
    if (Number.isFinite(priced) && priced > 0) unit = priced;
    options[id] = select.value;
    parts.push(`${label}: ${select.value}`);
  }
  const optionLine = parts.join("; ");
  return {
    ready,
    line: {
      sku,
      name,
      href,
      qty,
      unit,
      currency,
      options,
      optionLine,
    },
  };
}

export function paintCartBadge(): void {
  const count = cartCount();
  for (const node of document.querySelectorAll("[data-cart-count]")) {
    if (!(node instanceof HTMLElement)) continue;
    node.textContent = count > 0 ? String(count) : "";
    node.hidden = count < 1;
  }
  for (const link of document.querySelectorAll("[data-cart-link]")) {
    if (!(link instanceof HTMLElement)) continue;
    if (location.pathname === "/cart") link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
}
