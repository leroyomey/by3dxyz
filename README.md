# by3DXYZ

Local pottery-tools shop. Catalog on this site. Pay with **PayPal** on each tool page, or buy on [Etsy](https://by3dxyz.etsy.com).

## Run locally

```bash
npm install
npm run dev
```

Open the LAN URL Astro prints (for example `http://192.168.0.35:4322`).

## PayPal (no monthly fee)

One Client ID covers all tools. Prices come from `products.json`.

1. Log into PayPal (Business is best for selling)
2. Open [developer.paypal.com/dashboard/applications/live](https://developer.paypal.com/dashboard/applications/live)
3. Create an app (or open the default live app)
4. Copy the **Client ID** only — not the Secret
5. Paste it in `.env`:

```
PUBLIC_PAYPAL_CLIENT_ID=your_live_client_id
```

6. Restart `npm run dev`

Until that ID is set, **Buy** still goes to Etsy. After it is set, product pages show the gold PayPal button. PayPal takes about **3.49% + $0.49** per sale in the US. Quiet months cost $0.

Never put the PayPal **Secret** in this project.

## Order tickets

Each PayPal capture sends the shop the **SKU** (BO-001), **color**, **size**, **quantity**, total, PayPal order id, buyer email, and ship-to address.

You get that two ways:

1. PayPal Activity / PayPal’s sale email (line item SKU + options)
2. An email to `PUBLIC_ORDER_NOTIFY_EMAIL` (defaults to `hello@by3dxyz.com`)

The first notify email from Formsubmit asks you to click confirm. After that, orders land in the inbox on their own.

Order-ticket skill lives on this PC in `_private` (not in the public copy).

## Products

Each tool has a part number **BO-001** … **BO-052**, which appears at the end of the Etsy title in parentheses (`Throwing Rib (BO-001)`). That code plus the Etsy listing ID is how we tell a new listing from one already on the site. Guitar picks stay off the website for now.

```bash
npm run catalog:list
npm run catalog:auth
npm run catalog:sync
```

One-time shop login: on the **Open API** app (not Etsy Ads) at [etsy.com/developers/your-apps](https://www.etsy.com/developers/your-apps), add callback `https://by3dxyz.com/callback`, click **Save**, then `npm run catalog:auth` and allow access. After that, `catalog:sync` pulls stock per color and size. GitHub can run that sync every 8 hours once `ETSY_REFRESH_TOKEN` is in Actions secrets.

## GitHub Pages (after the one-time PC login)

**Keys and the going-live checklist** live on this PC in `_private/github-keys.md`. Do not commit `.env`. Before you zip or upload this folder, delete `_private`, `.cursor`, and `.env`.

The live site is a static snapshot. Etsy login still happens **once on this PC**. GitHub then keeps the catalog fresh without the PC staying on.

1. Finish `npm run catalog:auth` on this PC.
2. Push the project and add the secrets listed in that note (Etsy + PayPal Client ID + order email on the **Pages build**).
3. Turn on Pages. `.github/workflows/etsy-sync.yml` runs every 8 hours, updates `products.json` and photos, and commits.

If option-level stock stops updating, run `catalog:auth` on the PC again and paste the new `ETSY_REFRESH_TOKEN` into GitHub secrets.

Shop cards show listing totals. On a tool page, choosing color and size shows that option’s stock after a successful auth + sync.

Photos: `public/images/products/`. Catalog skill lives on this PC in `_private`.
