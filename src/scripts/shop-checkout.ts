import { clearCart, loadCart, readBuyState, type CartLine } from "./shop-cart";

type PayPalSdk = {
  FUNDING: { PAYPAL: string; PAYLATER: string; CARD: string };
  isFundingEligible?: (source: string) => boolean;
  Buttons: (config: Record<string, unknown>) => { render: (node: Element) => Promise<void> };
};

function paypalSdk(): PayPalSdk | undefined {
  return (window as Window & { paypal?: PayPalSdk }).paypal;
}

function loadSdk(clientId: string, currency: string): Promise<PayPalSdk | undefined> {
  const existing = paypalSdk();
  if (existing) return Promise.resolve(existing);
  const src =
    "https://www.paypal.com/sdk/js?client-id=" +
    encodeURIComponent(clientId) +
    "&currency=" +
    encodeURIComponent(currency) +
    "&enable-funding=card,paylater&disable-funding=venmo";
  const waiting = document.querySelector(`script[src^="https://www.paypal.com/sdk/js"]`);
  return new Promise((resolve) => {
    const done = () => resolve(paypalSdk());
    if (waiting) {
      waiting.addEventListener("load", done);
      if (paypalSdk()) done();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.onload = done;
    script.onerror = () => resolve(undefined);
    document.head.appendChild(script);
  });
}

function requestLines(lines: CartLine[]) {
  return lines.map((line) => ({ sku: line.sku, qty: line.qty, options: line.options || {} }));
}

function checkoutEndpoint(raw: string) {
  return raw.replace(/\/$/, "");
}

function turnstileApi() {
  return window.turnstile;
}

function loadTurnstile(): Promise<NonNullable<Window["turnstile"]> | undefined> {
  const existing = turnstileApi();
  if (existing) return Promise.resolve(existing);
  const waiting = document.querySelector('script[src*="challenges.cloudflare.com/turnstile"]');
  return new Promise((resolve) => {
    const done = () => resolve(turnstileApi());
    if (waiting) {
      waiting.addEventListener("load", done);
      if (turnstileApi()) done();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = done;
    script.onerror = () => resolve(undefined);
    document.head.appendChild(script);
  });
}

function checkoutProof(siteKey: string): Promise<string> {
  return loadTurnstile().then((turnstile) => {
    if (!turnstile || !siteKey) return Promise.reject(new Error("Checkout failed."));
    return new Promise((resolve, reject) => {
      const box = document.createElement("div");
      box.hidden = true;
      document.body.appendChild(box);
      const fail = () => {
        try {
          turnstile.remove(id);
        } catch {
          /* already gone */
        }
        box.remove();
        reject(new Error("Checkout failed."));
      };
      const id = turnstile.render(box, {
        sitekey: siteKey,
        size: "invisible",
        execution: "execute",
        callback: (token: string) => {
          try {
            turnstile.remove(id);
          } catch {
            /* already gone */
          }
          box.remove();
          if (!token) {
            reject(new Error("Checkout failed."));
            return;
          }
          resolve(token);
        },
        "error-callback": fail,
        "timeout-callback": fail,
      });
      turnstile.execute(id);
    });
  });
}

export function mountPayPal(opts: {
  container: HTMLElement;
  clientId: string;
  currency: string;
  checkoutUrl?: string;
  siteKey?: string;
  getLines: () => CartLine[] | null;
  clearOnPay?: boolean;
}): void {
  const { container, clientId, currency, getLines, clearOnPay } = opts;
  const checkoutUrl = checkoutEndpoint(opts.checkoutUrl || "");
  const siteKey = String(opts.siteKey || "").trim();
  if (!clientId || !checkoutUrl || !siteKey || container.dataset.ready === "true") return;
  container.dataset.ready = "true";

  loadTurnstile();
  loadSdk(clientId, currency).then((paypal) => {
    if (!paypal) return;

    let captureTicket = "";

    function syncShipping(orderID: string, country: string) {
      if (!captureTicket || !orderID) return Promise.reject(new Error("Checkout failed."));
      return fetch(checkoutUrl + "/shipping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderID, ticket: captureTicket, country: country || "" }),
      }).then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || "Checkout failed.");
      });
    }

    function goThanks(snapshot: unknown) {
      try {
        sessionStorage.setItem("by3dxyz-order", JSON.stringify(snapshot));
      } catch {
        /* private mode */
      }
      if (clearOnPay) clearCart();
      window.location.href = "/thanks";
    }

    const shared = {
      onClick: function (_data: unknown, actions: { reject: () => unknown; resolve: () => unknown }) {
        const lines = getLines();
        if (!lines || !lines.length) return actions.reject();
        return actions.resolve();
      },
      createOrder: function () {
        const lines = getLines();
        if (!lines || !lines.length) return Promise.reject(new Error("empty"));
        return checkoutProof(siteKey).then((turnstile) =>
          fetch(checkoutUrl + "/order", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lines: requestLines(lines), turnstile }),
          }).then(async (res) => {
            const body = await res.json().catch(() => ({}));
            if (!res.ok || !body.id || !body.ticket) throw new Error(body.error || "Checkout failed.");
            captureTicket = String(body.ticket);
            return body.id as string;
          }),
        );
      },
      onShippingChange: function (
        data: { orderID?: string; shipping_address?: { country_code?: string } },
        actions: { resolve: () => unknown; reject: () => unknown },
      ) {
        return syncShipping(data.orderID || "", data.shipping_address?.country_code || "").then(
          () => actions.resolve(),
          () => actions.reject(),
        );
      },
      onShippingAddressChange: function (
        data: { orderID?: string; shippingAddress?: { countryCode?: string } },
        actions: { reject: () => unknown },
      ) {
        return syncShipping(data.orderID || "", data.shippingAddress?.countryCode || "").then(
          () => undefined,
          () => actions.reject(),
        );
      },
      onApprove: function (data: { orderID?: string }) {
        return fetch(checkoutUrl + "/capture", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderID: data.orderID || "", ticket: captureTicket }),
        }).then(async (res) => {
          const body = await res.json().catch(() => ({}));
          if (!res.ok || !body.snapshot) throw new Error(body.error || "Capture failed.");
          goThanks(body.snapshot);
        });
      },
    };

    function mount(source: string | undefined, slot: string, style: Record<string, unknown>) {
      const node = container.querySelector(`[data-paypal-slot="${slot}"]`);
      if (!source || !node) return;
      const eligible = typeof paypal.isFundingEligible !== "function" || paypal.isFundingEligible(source);
      if (!eligible) {
        if (node instanceof HTMLElement) node.hidden = true;
        return;
      }
      paypal
        .Buttons(Object.assign({ fundingSource: source, style }, shared))
        .render(node)
        .catch(() => {
          if (node instanceof HTMLElement) node.hidden = true;
        });
    }

    mount(paypal.FUNDING.PAYPAL, "paypal", {
      color: "gold",
      shape: "rect",
      label: "paypal",
      height: 45,
      tagline: false,
    });
    mount(paypal.FUNDING.PAYLATER, "paylater", {
      color: "gold",
      shape: "rect",
      label: "paypal",
      height: 45,
      tagline: false,
    });
    mount(paypal.FUNDING.CARD, "card", {
      color: "black",
      shape: "rect",
      label: "pay",
      height: 45,
      tagline: false,
    });
  });
}

export function bootPayPalMounts(): void {
  for (const node of document.querySelectorAll("[data-paypal-mount]")) {
    if (!(node instanceof HTMLElement)) continue;
    const clientId = node.getAttribute("data-paypal-client") || "";
    const currency = node.getAttribute("data-paypal-currency") || "USD";
    const checkoutUrl = node.getAttribute("data-paypal-checkout") || "";
    const siteKey = node.getAttribute("data-turnstile-site") || "";
    const mode = node.getAttribute("data-paypal-mode") || "buy";
    if (!clientId || !checkoutUrl || !siteKey) continue;
    mountPayPal({
      container: node,
      clientId,
      currency,
      checkoutUrl,
      siteKey,
      clearOnPay: mode === "cart",
      getLines: () => {
        if (mode === "cart") {
          const lines = loadCart();
          return lines.length ? lines : null;
        }
        const buy = node.closest("[data-buy]") || document.querySelector("[data-buy]");
        if (!buy) return null;
        const state = readBuyState(buy);
        return state.ready ? [state.line] : null;
      },
    });
  }
}
