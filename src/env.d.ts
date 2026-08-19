/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_PAYPAL_CLIENT_ID?: string;
  readonly PUBLIC_ORDER_NOTIFY_EMAIL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
