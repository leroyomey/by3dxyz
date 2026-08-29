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
  by3dxyzIsTrustedFileLink?: (raw: string) => boolean;
  by3dxyzVisitTimer?: number;
  by3dxyzVisitBound?: boolean;
  by3dxyzVisitBusy?: boolean;
  by3dxyzVisitDone?: boolean;
  by3dxyzVisitN?: number;
  by3dxyzBuyClick?: boolean;
  by3dxyzCartUi?: boolean;
}
