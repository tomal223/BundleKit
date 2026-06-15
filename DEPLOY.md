# BundleKit — Deployment Guide

## Step 1 — Shopify Partner Dashboard

You need these from https://partners.shopify.com → Apps → BundleKit → Settings:

| Variable | Where to find it |
|---|---|
| `SHOPIFY_API_KEY` | Client ID |
| `SHOPIFY_API_SECRET` | Client secret |

Set the **App URL** and **Allowed redirection URL(s)** to your production domain once you have it (Step 3 does this automatically via `shopify app deploy`).

## Step 2 — Database (PostgreSQL)

Pick one: Railway, Supabase, or Neon (all have generous free tiers).

1. Create a new Postgres database
2. Copy the connection string → set as `DATABASE_URL` on your host
3. In `prisma/schema.prisma` change the datasource:
   ```
   provider = "postgresql"
   ```
4. Install the pg adapter: `npm install @prisma/adapter-pg pg`
5. Run migrations: `npx prisma migrate deploy`

## Step 3 — Host (Vercel recommended)

```bash
# 1. Push to GitHub
git init && git add . && git commit -m "Initial BundleKit build"
git remote add origin https://github.com/YOUR_ORG/bundlekit.git
git push -u origin main

# 2. Connect repo to Vercel
#    vercel.com → New Project → Import your repo
#    Framework: Other (Remix/React Router)
#    Build: npm run build
#    Output: build/

# 3. Set environment variables in Vercel dashboard:
#    SHOPIFY_API_KEY
#    SHOPIFY_API_SECRET
#    SHOPIFY_APP_URL   (your Vercel domain, e.g. bundlekit.vercel.app)
#    SCOPES            write_products,write_discounts
#    DATABASE_URL      (your Postgres connection string)
#    NODE_ENV          production
```

## Step 4 — Link & deploy to Shopify

```bash
# One-time: link local code to your Partner app
npx shopify app config link

# Update shopify.app.toml with production URL, then:
npx shopify app deploy
```

This publishes both extensions (widget + discount function) and registers
all webhooks. After this the app URL, OAuth redirects, webhook endpoints,
and App Proxy routing are all set automatically.

## Step 5 — Custom domain (optional but recommended for BFS)

1. Buy `app.bundlekit.io` (or whatever you choose)
2. In your DNS: `CNAME app → cname.vercel-dns.com`
3. In Vercel: Domains → add `app.bundlekit.io`
4. Update `shopify.app.toml`:
   ```toml
   [app_proxy]
   url = "https://app.bundlekit.io/api/proxy"
   ```
5. Update `SHOPIFY_APP_URL=https://app.bundlekit.io` on Vercel
6. `npx shopify app deploy` again

## Step 6 — Submit for review

Partner Dashboard → Apps → BundleKit → Distribution → Submit for review.

Pre-submission checklist (your machine, dev store):
- [ ] Install app on a dev store — OAuth flow completes
- [ ] Create a quantity break → activate → buy product → confirm discount applies
- [ ] Pause offer → add same product → confirm NO discount (ghost-discount test)
- [ ] Open theme editor → add BundleKit block → confirm widget renders on product page
- [ ] Run Lighthouse on a product page with the widget → score ≥ 90
- [ ] All 3 GDPR webhook endpoints return 200 (test via Partner Dashboard → Webhooks)

## Credentials I need from you

None stored in this repo. All secrets go in your host's env vars. The file
`.env.example` lists every variable with descriptions.
