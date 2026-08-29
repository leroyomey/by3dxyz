/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_PAYPAL_CLIENT_ID?: string;
  readonly PUBLIC_ORDER_NOTIFY_EMAIL?: string;
  readonly PUBLIC_CHECKOUT_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  turnstile?: {
    render: (el: HTMLElement, opts: Record<string, unknown>) => string;
    execute: (id: string) => void;
    remove: (id: string) => void;
  };
  by3dxyzIsTrustedFileLink?: (raw: string) => boolean;
  by3dxyzBuyClick?: boolean;
  by3dxyzCartUi?: boolean;
}
