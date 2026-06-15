# BundleKit

Quantity breaks, BOGO, bundles, and free gifts for Shopify — built to
"Built for Shopify" standards from commit 1.

Built on Shopify's official React Router 7 app template with Polaris Web
Components, Theme App Extensions, and a JavaScript Discount Function.

## Architecture in one paragraph

Offers live in the app database (source of truth). Every offer mutation ends
with a sync that writes **only active, in-window offers** to an app-reserved
shop metafield (`$app:bundlekit/offers`). The Shopify Discount Function reads
that metafield at checkout — zero network calls — so a paused or deleted offer
is *architecturally incapable* of applying a discount ("ghost discount
prevention"). The storefront widget is a 3KB framework-free Web Component
served from Shopify's CDN that fetches display config through the App Proxy.

```
Admin UI (Polaris WC + App Bridge)
   └─ OfferService ── writes ──► PostgreSQL/SQLite (truth)
                 └─── syncs ───► Shop metafield ($app:bundlekit/offers)
                                      │ read at checkout (no network)
                                      ▼
                       Discount Function (cart.lines.discounts.generate.run)
Storefront widget ◄── App Proxy (/apps/bundlekit/offers) — display only
```

## Project layout

| Path | What |
|---|---|
| `app/routes/app.*` | Embedded admin (dashboard, offer wizard, analytics, settings/billing) |
| `app/routes/webhooks.*` | app/uninstalled + 3 GDPR handlers (+ dormant orders/paid) |
| `app/routes/api.proxy.offers.tsx` | Public storefront endpoint (App Proxy, HMAC-verified) |
| `app/services/` | offer (CRUD + metafield sync), metafield, discount, analytics |
| `extensions/bundlekit-discount/` | JS Discount Function — all offer math, fail-closed |
| `extensions/bundle-widget/` | Theme App Extension — 4 blocks, Web Component, CSS |
| `prisma/` | Schema + migrations (SQLite dev / PostgreSQL prod) |
| `tests/` | Unit + e2e, including the ghost-discount suite (never skip) |

## Local development

```bash
npm install
npx prisma generate
npm run dev          # shopify app dev — handles tunnel, auth, hot reload
npm test             # 58 tests incl. ghost discount prevention
```

First run: `shopify app config link` to connect to your Partner app, then
`npm run dev` and install on a dev store.

## Production notes

- **Database**: switch `prisma/schema.prisma` datasource to `postgresql`,
  swap `PrismaBetterSQLite3` for `@prisma/adapter-pg` in `app/db.server.ts`,
  set `DATABASE_URL`. Schema is already Postgres-compatible.
- **Billing**: Growth $14.99 / Pro $29.99 via Shopify Billing API, 14-day
  trials. `isTest` is driven by `NODE_ENV`.
- **Revenue attribution**: `webhooks.orders.paid.tsx` is ready but dormant —
  enabling requires `read_orders` + Protected Customer Data approval (see
  comments in that file).
- **Deploy**: `npx shopify app deploy` publishes both extensions; CI deploy
  step in `.github/workflows/ci.yml` is ready to uncomment.

## Built for Shopify checklist

- [x] Embedded admin via App Bridge + session tokens (no cookies)
- [x] Polaris Web Components admin UI
- [x] Theme App Extension only — zero theme.liquid edits
- [x] Shopify Functions for discounts (current Discount Function API)
- [x] Mandatory GDPR webhooks (data_request / redact / shop redact)
- [x] App uninstall cleanup (sessions + tokens cleared immediately)
- [x] Billing exclusively through Shopify Billing API
- [x] Widget: <3KB gzipped, semantic HTML, never emits h1/h2, XSS-escaped
- [x] Fail-closed function: malformed/stale config → zero discounts
- [ ] Lighthouse ≥ 90 on a dev store (run before submission)
- [ ] App listing assets (icon, screenshots, description)

## The two tests that must never be deleted

1. `tests/e2e/ghost-discount.test.ts` — proves deactivated offers can't discount.
2. `tests/unit/widget-seo.test.ts` — proves the widget never renders h1/h2.
