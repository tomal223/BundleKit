# Shopify Bundle App — Complete Build Plan
### System Design → Development Architecture → Claude Code Execution Plan

**App Codename:** BundleKit  
**Target:** "Built for Shopify" badge compliance from day 1  
**Build Tool:** Claude Code  
**Stack:** Remix + Shopify CLI 3.x + Shopify Functions + PostgreSQL  

---

## PART 1 — SYSTEM DESIGN

### 1.1 Functional Requirements

| Layer | Requirement |
|---|---|
| Merchant Admin | Create/edit/delete discount offers |
| Merchant Admin | Set offer type: Quantity Break, BOGO, Bundle, Free Gift |
| Merchant Admin | Target by product, collection, or all products |
| Merchant Admin | Schedule offers (start/end date) |
| Merchant Admin | Analytics: revenue lift, AOV, offer performance |
| Storefront | Render quantity break widget on product page |
| Storefront | Render bundle widget (buy X get Y) |
| Storefront | Progress bar toward discount unlock |
| Checkout | Apply correct discount atomically via Shopify Functions |
| Checkout | Never apply deactivated discounts (hard guarantee) |
| SEO | All storefront widgets use semantic HTML (h2/h3 only, never h1) |
| Compliance | Theme App Extension only — zero liquid injection into merchant theme |

### 1.2 Non-Functional Requirements

| Dimension | Target |
|---|---|
| Storefront widget load | < 50ms render (Web Component, no framework) |
| Widget JS bundle size | < 12KB gzipped |
| Admin app load (embedded) | < 2s initial, < 500ms navigations |
| Shopify Functions execution | < 5ms (Shopify's hard limit is 50ms) |
| Uptime | 99.9% (Vercel/Railway + managed DB) |
| "Built for Shopify" | Pass all criteria at launch |
| SEO safe | Zero H1 conflicts, valid heading hierarchy always |

### 1.3 "Built for Shopify" Badge Checklist (Must-Pass)

These are hard requirements — build to them from commit 1:

- [ ] Uses Shopify App Bridge for embedded admin UI
- [ ] Uses Theme App Extensions for storefront (no `theme.liquid` edits)
- [ ] Uses Shopify Functions for discount logic (not Scripts or server-side price manipulation)
- [ ] Passes Shopify's performance benchmark (Lighthouse ≥ 90 on storefront)
- [ ] Admin routes use session tokens (not cookies)
- [ ] App passes Shopify security review (no eval(), no external script injection)
- [ ] Works with Online Store 2.0 themes AND legacy themes
- [ ] Handles app uninstall / GDPR webhooks
- [ ] Responsive admin UI using Polaris

---

## PART 2 — ARCHITECTURE

### 2.1 Component Map

```
┌─────────────────────────────────────────────────────────┐
│                    SHOPIFY PLATFORM                      │
│                                                          │
│  ┌──────────────┐    ┌──────────────┐                   │
│  │  Admin UI    │    │  Storefront  │                   │
│  │  (Embedded   │    │  (Theme App  │                   │
│  │   App Bridge)│    │   Extension) │                   │
│  └──────┬───────┘    └──────┬───────┘                   │
│         │                   │                            │
│         │ REST/GraphQL       │ Asset served by Shopify   │
│         │ Admin API          │ CDN (no round trip)       │
│         │                   │                            │
│  ┌──────▼───────────────────▼────────────────────────┐  │
│  │           Shopify Functions Layer                  │  │
│  │  ┌─────────────────┐  ┌────────────────────────┐  │  │
│  │  │ discount.wasm   │  │ cart-transform.wasm    │  │  │
│  │  │ (Quantity Break │  │ (Bundle price          │  │  │
│  │  │  + BOGO logic)  │  │  adjustment)           │  │  │
│  │  └─────────────────┘  └────────────────────────┘  │  │
│  │  Reads offer config from metafields (no DB call)   │  │
│  └────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                         │
                         │ HTTPS
                         │
┌────────────────────────▼────────────────────────────────┐
│                   APP BACKEND (Remix)                    │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  /app routes │  │  /webhooks   │  │  /api routes │  │
│  │  (Admin UI)  │  │  (Shopify    │  │  (Storefront │  │
│  │              │  │   events)    │  │   config     │  │
│  └──────┬───────┘  └──────┬───────┘  │   endpoint)  │  │
│         │                 │          └──────┬───────┘  │
│         └────────┬─────────┘                │          │
│                  │                          │          │
│         ┌────────▼──────────────────────────▼──────┐   │
│         │           Service Layer                  │   │
│         │  OfferService  |  AnalyticsService       │   │
│         │  MetafieldSync |  WebhookProcessor       │   │
│         └────────────────────────────────────────┘   │
│                                                          │
│  ┌───────────────────┐    ┌─────────────────────────┐   │
│  │   PostgreSQL DB    │    │   Shopify Metafields     │   │
│  │   (Offers, shops,  │    │   (Offer config mirror   │   │
│  │    analytics,      │◄──►│    for Functions — no    │   │
│  │    sessions)       │    │    DB call at checkout)  │   │
│  └───────────────────┘    └─────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### 2.2 The Critical Design Decision: Why Metafield Sync

Pumper's core bug (ghost discounts from deactivated offers) happens because their discount logic runs on their server and checks their DB at checkout — with potential race conditions and caching.

**Our approach:**
- Offer configs live in PostgreSQL (source of truth)
- On every create/update/delete, the backend **syncs offer state to Shopify metafields**
- Shopify Functions read from metafields — they never call our server
- When a merchant deactivates an offer: metafield is deleted/flagged immediately
- The Function reads `null` → applies zero discount → impossible to apply ghost discounts

This is the architectural guarantee of discount accuracy.

### 2.3 Storefront Widget Design

The widget is a Theme App Extension — a `.js` + `.liquid` block Shopify serves from their CDN.

**No framework. Pure Web Components.**

```
storefront/
├── extensions/
│   └── bundle-widget/
│       ├── assets/
│       │   ├── bundle-widget.js      # <8KB gzipped Web Component
│       │   └── bundle-widget.css     # <2KB, CSS custom properties
│       └── blocks/
│           ├── quantity-breaks.liquid
│           ├── bundle-offer.liquid
│           └── progress-bar.liquid
```

**SEO guarantee in the widget:**

```html
<!-- NEVER rendered by our widget -->
<h1>Buy 3 Save 20%</h1>  ❌

<!-- ALWAYS rendered by our widget -->
<div class="bk-offer-label" role="heading" aria-level="3">
  Buy 3 Save 20%
</div>
```

Or if actual heading tags needed:
```html
<h3 class="bk-tier-label">Buy 3, Save 20%</h3>  ✅
```

Widget never emits `<h1>` or `<h2>`. Period. Enforce in code review and add a test.

---

## PART 3 — DATA MODEL

### 3.1 PostgreSQL Schema

```sql
-- Shops (one per installed store)
CREATE TABLE shops (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_domain   TEXT UNIQUE NOT NULL,
  access_token  TEXT NOT NULL,  -- encrypted at rest
  plan          TEXT DEFAULT 'free',  -- free | growth | pro
  installed_at  TIMESTAMPTZ DEFAULT now(),
  uninstalled_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Offers (the core entity)
CREATE TABLE offers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id       UUID REFERENCES shops(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,  -- quantity_break | bogo | bundle | free_gift
  status        TEXT DEFAULT 'active',  -- active | paused | scheduled | expired
  title         TEXT NOT NULL,  -- internal name
  
  -- Targeting
  target_type   TEXT NOT NULL,  -- all | product | collection | variant
  target_ids    TEXT[],  -- product/collection GIDs
  
  -- Discount config (JSONB for flexibility per offer type)
  config        JSONB NOT NULL,
  -- quantity_break example:
  -- { "tiers": [{"qty": 2, "type": "pct", "value": 10}, {"qty": 3, "type": "pct", "value": 20}] }
  -- bogo example:
  -- { "buy_qty": 1, "get_qty": 1, "get_product_gid": "gid://...", "discount_pct": 100 }
  
  -- Scheduling
  starts_at     TIMESTAMPTZ,
  ends_at       TIMESTAMPTZ,
  
  -- Shopify sync
  function_id         TEXT,  -- Shopify Function ID this offer uses
  metafield_synced_at TIMESTAMPTZ,
  
  -- Priority for conflict resolution (lower = higher priority)
  priority      INT DEFAULT 0,
  
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_offers_shop_status ON offers(shop_id, status);
CREATE INDEX idx_offers_target ON offers USING GIN(target_ids);

-- Analytics events (append-only)
CREATE TABLE analytics_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     UUID REFERENCES shops(id) ON DELETE CASCADE,
  offer_id    UUID REFERENCES offers(id) ON DELETE SET NULL,
  event_type  TEXT NOT NULL,  -- offer_viewed | discount_applied | order_completed
  order_id    TEXT,
  base_amount NUMERIC(10,2),
  discount_amount NUMERIC(10,2),
  currency    TEXT DEFAULT 'USD',
  occurred_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_analytics_shop_time ON analytics_events(shop_id, occurred_at DESC);
CREATE INDEX idx_analytics_offer ON analytics_events(offer_id, occurred_at DESC);

-- Aggregated daily stats (materialized for dashboard speed)
CREATE TABLE analytics_daily (
  shop_id       UUID REFERENCES shops(id) ON DELETE CASCADE,
  offer_id      UUID REFERENCES offers(id) ON DELETE CASCADE,
  date          DATE NOT NULL,
  views         INT DEFAULT 0,
  discounts_applied INT DEFAULT 0,
  discount_total NUMERIC(10,2) DEFAULT 0,
  revenue_attributed NUMERIC(10,2) DEFAULT 0,
  PRIMARY KEY (shop_id, offer_id, date)
);
```

### 3.2 Metafield Structure (Shopify-side)

```
namespace: bundlekit
key: offers
type: json
owner: shop

value: {
  "v": 1,
  "offers": [
    {
      "id": "uuid",
      "type": "quantity_break",
      "status": "active",  // only "active" offers synced here
      "target_type": "product",
      "target_ids": ["gid://shopify/Product/123"],
      "config": { "tiers": [...] },
      "ends_at": null
    }
  ]
}
```

Rule: **Only `status: active` offers are written to metafields.** Pausing = immediate metafield update = discount stops at next checkout evaluation.

---

## PART 4 — SHOPIFY FUNCTIONS

### 4.1 Discount Function (Rust — production)

```
extensions/
└── discount-function/
    ├── src/
    │   └── main.rs
    ├── schema.graphql
    └── shopify.extension.toml
```

```rust
// src/main.rs — simplified structure
use shopify_function::prelude::*;
use serde::{Deserialize, Serialize};

#[shopify_function]
fn function(input: input::ResponseData) -> Result<output::FunctionRunResult> {
    // 1. Read offers from shop metafield (no network call — Shopify injects this)
    let offers = parse_offers(&input.shop.metafield);
    
    // 2. If no offers, return no discounts immediately
    if offers.is_empty() {
        return Ok(output::FunctionRunResult { discounts: vec![], discount_application_strategy: Strategy::FIRST });
    }
    
    // 3. For each cart line, find applicable active offer
    let mut discounts = vec![];
    for line in &input.cart.lines {
        let product_id = &line.merchandise.product.id;
        let quantity = line.quantity;
        
        for offer in &offers {
            // Status check — belt AND suspenders (metafield sync is primary guard)
            if offer.status != "active" { continue; }
            
            // Expiry check
            if let Some(ends_at) = &offer.ends_at {
                if is_expired(ends_at) { continue; }
            }
            
            // Target check
            if !applies_to(offer, product_id) { continue; }
            
            // Calculate discount
            if let Some(discount) = calculate_discount(offer, quantity, line) {
                discounts.push(discount);
                break; // one offer per line item (highest priority wins)
            }
        }
    }
    
    Ok(output::FunctionRunResult {
        discounts,
        discount_application_strategy: Strategy::FIRST,
    })
}
```

**Key properties of this approach:**
- Zero network calls at checkout — pure computation on injected data
- Rust compiles to WASM — executes in < 2ms typically
- Expired offers checked at function time (double-guard vs. metafield sync)
- One discount per line — no stacking bugs

### 4.2 Cart Transform Function (for bundle price display)

Used when bundle offers need to show "was X, now Y" at item level in cart:

```toml
# shopify.extension.toml
[[extensions]]
name = "BundleKit Discount"
handle = "bundlekit-discount"
type = "function"
api_version = "2024-07"

[[extensions.targeting]]
module = "./src/main.rs"
target = "purchase.discount-codes-and-automatic-discounts.converts-1"
```

---

## PART 5 — BACKEND (REMIX APP)

### 5.1 Directory Structure

```
app/
├── routes/
│   ├── app._index.tsx          # Dashboard
│   ├── app.offers._index.tsx   # Offer list
│   ├── app.offers.new.tsx      # Create offer
│   ├── app.offers.$id.tsx      # Edit offer
│   ├── app.analytics.tsx       # Analytics page
│   ├── app.settings.tsx        # Plan + billing
│   ├── api.offers.tsx          # Storefront config endpoint
│   ├── webhooks.tsx            # Shopify webhook handler
│   └── auth.$.tsx              # OAuth flow
│
├── services/
│   ├── offer.service.ts        # CRUD + metafield sync
│   ├── analytics.service.ts    # Event ingestion + aggregation
│   ├── metafield.service.ts    # Shopify metafield read/write
│   ├── billing.service.ts      # Shopify billing API
│   └── webhook.service.ts      # Webhook verification + routing
│
├── models/
│   ├── shop.server.ts
│   ├── offer.server.ts
│   └── analytics.server.ts
│
├── components/
│   ├── OfferForm/
│   ├── TierEditor/
│   ├── AnalyticsDashboard/
│   └── PlanGating/
│
└── shopify.server.ts           # Shopify API client config
```

### 5.2 Critical Service: OfferService

```typescript
// services/offer.service.ts

export class OfferService {
  
  async createOffer(shopId: string, data: CreateOfferInput) {
    const offer = await db.offer.create({ data: { ...data, shopId } });
    await this.syncMetafields(shopId);  // ALWAYS sync after mutation
    return offer;
  }

  async updateOffer(id: string, shopId: string, data: UpdateOfferInput) {
    const offer = await db.offer.update({ where: { id, shopId }, data });
    await this.syncMetafields(shopId);
    return offer;
  }

  async pauseOffer(id: string, shopId: string) {
    await db.offer.update({
      where: { id, shopId },
      data: { status: 'paused', updatedAt: new Date() }
    });
    // Sync IMMEDIATELY — this is the ghost discount prevention
    await this.syncMetafields(shopId);
  }

  async deleteOffer(id: string, shopId: string) {
    await db.offer.delete({ where: { id, shopId } });
    await this.syncMetafields(shopId);  // Removes from metafield
  }

  // Core sync: write only ACTIVE offers to metafield
  private async syncMetafields(shopId: string) {
    const shop = await db.shop.findUnique({ where: { id: shopId } });
    
    const activeOffers = await db.offer.findMany({
      where: {
        shopId,
        status: 'active',
        OR: [
          { endsAt: null },
          { endsAt: { gt: new Date() } }
        ]
      }
    });

    const metafieldValue = {
      v: 1,
      offers: activeOffers.map(serializeForFunction)
    };

    await shopifyAdmin(shop.accessToken).request(SET_METAFIELD_MUTATION, {
      variables: {
        metafields: [{
          namespace: 'bundlekit',
          key: 'offers',
          type: 'json',
          value: JSON.stringify(metafieldValue),
          ownerId: `gid://shopify/Shop/${shop.shopifyId}`
        }]
      }
    });

    await db.shop.update({
      where: { id: shopId },
      data: { metafieldSyncedAt: new Date() }
    });
  }
}
```

### 5.3 Webhook Handler

Required for "Built for Shopify" compliance:

```typescript
// routes/webhooks.tsx

const HANDLERS: Record<string, WebhookHandler> = {
  'APP_UNINSTALLED': async (shopDomain) => {
    await db.shop.update({
      where: { shopDomain },
      data: { uninstalledAt: new Date(), accessToken: '' }  // Clear token
    });
  },
  
  'CUSTOMERS_DATA_REQUEST': async (shopDomain, payload) => {
    // GDPR: Return customer data (for shops with customer analytics)
    await sendCustomerDataExport(shopDomain, payload.customer);
  },
  
  'CUSTOMERS_REDACT': async (shopDomain, payload) => {
    // GDPR: Delete customer analytics data
    await db.analyticsEvent.deleteMany({
      where: { shopId: payload.shopId, customerId: payload.customer.id }
    });
  },
  
  'SHOP_REDACT': async (shopDomain) => {
    // GDPR: Full shop data deletion (48h after uninstall)
    await db.shop.delete({ where: { shopDomain } });
  },
  
  'ORDERS_PAID': async (shopDomain, payload) => {
    // Record analytics for revenue attribution
    await analyticsService.recordOrder(shopDomain, payload);
  }
};
```

---

## PART 6 — STOREFRONT WIDGET

### 6.1 Web Component (Zero Framework)

```javascript
// extensions/bundle-widget/assets/bundle-widget.js
// Target: < 8KB gzipped

class BundleKitWidget extends HTMLElement {
  
  static get observedAttributes() {
    return ['product-id', 'variant-id', 'current-price'];
  }

  connectedCallback() {
    this._offersCache = null;
    this._render();
  }

  async _render() {
    const productId = this.getAttribute('product-id');
    const offers = await this._getOffers(productId);
    
    if (!offers.length) {
      this.style.display = 'none';
      return;
    }
    
    this.innerHTML = this._buildHTML(offers);
    this._attachListeners();
  }

  _buildHTML(offers) {
    // CRITICAL: Never use h1. Use h3 or div[role=heading][aria-level=X]
    return `
      <div class="bk-widget" role="region" aria-label="Discount offers">
        ${offers.map(offer => this._renderOffer(offer)).join('')}
      </div>
    `;
  }

  _renderQuantityBreak(offer) {
    const tiers = offer.config.tiers;
    return `
      <div class="bk-qty-break">
        <h3 class="bk-offer-title">${this._escape(offer.title)}</h3>
        <div class="bk-tiers" role="list">
          ${tiers.map(tier => `
            <div class="bk-tier ${this._isActive(tier) ? 'bk-tier--active' : ''}" role="listitem">
              <span class="bk-tier-qty">Buy ${tier.qty}+</span>
              <span class="bk-tier-discount">${this._formatDiscount(tier)}</span>
              <span class="bk-tier-price">${this._formatPrice(tier)}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  // Offers fetched from our API (cached in sessionStorage, NOT localStorage)
  async _getOffers(productId) {
    const cacheKey = `bk_offers_${productId}`;
    const cached = sessionStorage.getItem(cacheKey);
    
    if (cached) return JSON.parse(cached);
    
    const resp = await fetch(
      `/apps/bundlekit/offers?product_id=${productId}`,
      { headers: { 'Accept': 'application/json' } }
    );
    
    const data = await resp.json();
    sessionStorage.setItem(cacheKey, JSON.stringify(data.offers));
    return data.offers;
  }

  _escape(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

customElements.define('bundlekit-widget', BundleKitWidget);
```

### 6.2 Liquid Block (Theme App Extension)

```liquid
{%- comment -%} extensions/bundle-widget/blocks/quantity-breaks.liquid {%- endcomment -%}

<bundlekit-widget
  product-id="{{ product.id }}"
  variant-id="{{ product.selected_or_first_available_variant.id }}"
  current-price="{{ product.selected_or_first_available_variant.price }}"
  currency="{{ cart.currency.iso_code }}"
>
  {%- comment -%} SSR fallback for no-JS (also important for SEO crawlers) {%- endcomment -%}
  <noscript>
    <p>Volume discounts available — add to cart to see pricing.</p>
  </noscript>
</bundlekit-widget>

{{ 'bundle-widget.js' | asset_url | script_tag }}
{{ 'bundle-widget.css' | asset_url | stylesheet_tag }}
```

---

## PART 7 — ADMIN UI (POLARIS)

### 7.1 Offer Creation Flow

```
Dashboard → "Create Offer" → 
  Step 1: Choose offer type (Quantity Break / BOGO / Bundle / Free Gift)
  Step 2: Set targeting (All products / Specific products / Collection)
  Step 3: Configure tiers/rules
  Step 4: Set schedule (optional)
  Step 5: Preview + Publish
```

### 7.2 Key UI Components

```tsx
// components/TierEditor/TierEditor.tsx
// Polaris-based tier editor for quantity breaks

import { Card, TextField, Select, Button, InlineStack, Text } from '@shopify/polaris';

interface Tier {
  qty: number;
  discountType: 'pct' | 'flat' | 'fixed_price';
  value: number;
}

export function TierEditor({ tiers, onChange }: TierEditorProps) {
  return (
    <Card>
      <Text variant="headingMd" as="h2">Discount Tiers</Text>
      {tiers.map((tier, i) => (
        <InlineStack key={i} gap="300" align="center">
          <TextField
            label="Min Quantity"
            type="number"
            value={String(tier.qty)}
            onChange={(v) => updateTier(i, 'qty', Number(v))}
            min={1}
          />
          <Select
            label="Discount Type"
            options={DISCOUNT_TYPE_OPTIONS}
            value={tier.discountType}
            onChange={(v) => updateTier(i, 'discountType', v)}
          />
          <TextField
            label={tier.discountType === 'pct' ? 'Percent Off' : 'Amount Off'}
            type="number"
            value={String(tier.value)}
            onChange={(v) => updateTier(i, 'value', Number(v))}
          />
          <Button tone="critical" onClick={() => removeTier(i)}>Remove</Button>
        </InlineStack>
      ))}
      <Button onClick={addTier}>+ Add Tier</Button>
    </Card>
  );
}
```

---

## PART 8 — PRICING ARCHITECTURE

| Plan | Price | Limits | Feature Gate |
|---|---|---|---|
| **Free** | $0 | Up to $500 bundled GMV/month | Quantity breaks only, basic widget |
| **Growth** | $14.99/mo | Up to $10K bundled GMV/month | + BOGO, Free Gift, Progress Bar |
| **Pro** | $29.99/mo | Unlimited GMV | + Bundle builder, A/B test, priority support |

**Revenue-limit model justification:** Aligns our revenue with merchant success. No arbitrary offer caps (direct attack on Pumper's 5-offer limit). Merchants who don't use bundles never pay.

**Billing implementation:** Shopify Billing API (app subscriptions). No Stripe. All billing goes through Shopify — required for App Store listing and simplifies merchant trust.

---

## PART 9 — CLAUDE CODE EXECUTION PLAN

### Phase 1 — Foundation (Week 1–2)

**Milestone:** Shopify app installs, passes auth, renders blank admin

```
Claude Code tasks:
1. scaffold:  npx @shopify/create-app@latest --name bundlekit --template remix
2. configure: shopify.app.toml — scopes, webhooks, extensions
3. database:  Set up Prisma + PostgreSQL schema (shops, offers tables)
4. auth:      Verify OAuth flow, session token validation
5. webhooks:  APP_UNINSTALLED + 3x GDPR handlers
6. deploy:    Vercel (frontend) + Railway/Supabase (Postgres)
```

**Deliverable:** `shopify app deploy` succeeds, app installs on dev store.

### Phase 2 — Shopify Function (Week 2–3)

**Milestone:** Quantity break discount applies correctly at checkout, deactivated offer = zero discount

```
Claude Code tasks:
1. scaffold:  shopify app generate extension --template discount --name bundlekit-discount
2. schema:    Write GraphQL input query (cart lines, metafields)
3. logic:     Implement Rust function (tier matching, discount calculation)
4. test:      shopify app function run (local testing)
5. sync:      Implement metafield sync service in backend
6. e2e test:  Create offer → buy product → verify discount → pause offer → verify no discount
```

**Deliverable:** Discount accuracy test suite passes. Ghost discount scenario verified impossible.

### Phase 3 — Storefront Widget (Week 3–4)

**Milestone:** Widget renders on product page, correct tiers displayed, semantic HTML

```
Claude Code tasks:
1. scaffold:  shopify app generate extension --template theme --name bundle-widget
2. component: Build BundleKitWidget Web Component
3. styles:    CSS custom properties, responsive, < 2KB
4. blocks:    quantity-breaks.liquid, bundle-offer.liquid, progress-bar.liquid
5. API:       /api/offers route (public, cached, returns active offers by product)
6. audit:     Lighthouse run — confirm no H1 conflicts, score ≥ 90
```

**Deliverable:** Widget live on dev store, Lighthouse ≥ 90, zero heading hierarchy warnings.

### Phase 4 — Admin UI (Week 4–5)

**Milestone:** Full offer CRUD in Polaris admin, analytics dashboard

```
Claude Code tasks:
1. dashboard:  Offers list (Polaris DataTable), status badges, quick-pause toggle
2. create:     Wizard: type → targeting → tiers → schedule → preview
3. edit:       Same form, pre-populated, update + re-sync
4. analytics:  Revenue chart, AOV lift, top offers (Recharts or Polaris Charts)
5. settings:   Plan display, Shopify Billing upgrade flow
```

**Deliverable:** End-to-end offer lifecycle works in admin.

### Phase 5 — BOGO + Free Gift (Week 5–6)

**Milestone:** Full offer type coverage

```
Claude Code tasks:
1. function:  Extend Rust function with BOGO + free gift logic
2. UI:        BOGO config form (buy X get Y product/variant)
3. UI:        Free gift selector (threshold-based gift product)
4. widget:    bogo-offer.liquid + free-gift.liquid blocks
5. test:      E2E for each offer type
```

### Phase 6 — Polish + "Built for Shopify" Audit (Week 6–7)

```
Claude Code tasks:
1. performance: Bundle size audit (<12KB JS target)
2. a11y:        Keyboard nav, ARIA labels, screen reader test
3. security:    CSP headers, no eval(), XSS audit on widget rendering
4. compliance:  Run Shopify's app review checklist manually
5. docs:        In-app onboarding (empty state guidance)
6. submit:      Shopify Partner Dashboard → Submit for review
```

---

## PART 10 — TESTING STRATEGY

### Critical Test: The Ghost Discount Prevention

This test must never be deleted or skipped:

```typescript
describe('Ghost Discount Prevention', () => {
  it('deactivated offer NEVER applies discount at checkout', async () => {
    // 1. Create active quantity break offer
    const offer = await createOffer({ type: 'quantity_break', status: 'active', ... });
    
    // 2. Verify metafield contains offer
    const metafield = await getShopMetafield(testShop);
    expect(metafield.offers).toContainEqual(expect.objectContaining({ id: offer.id }));
    
    // 3. Deactivate offer
    await offerService.pauseOffer(offer.id, testShop.id);
    
    // 4. Verify metafield NO LONGER contains offer
    const updatedMetafield = await getShopMetafield(testShop);
    expect(updatedMetafield.offers).not.toContainEqual(
      expect.objectContaining({ id: offer.id })
    );
    
    // 5. Simulate function execution with updated metafield
    const result = await runDiscountFunction({ offers: updatedMetafield.offers, cart: testCart });
    
    // 6. Verify zero discounts applied
    expect(result.discounts).toHaveLength(0);
  });
});
```

### SEO Safety Test

```typescript
describe('SEO Safety', () => {
  it('widget HTML never contains h1 elements', () => {
    const widget = new BundleKitWidget();
    widget.setAttribute('product-id', '123');
    
    const rendered = widget.innerHTML;
    
    // Zero h1 tags in any form
    expect(rendered).not.toMatch(/<h1[\s>]/i);
  });
  
  it('widget uses correct ARIA heading levels', () => {
    // Offer titles should be h3 or aria-level="3"
    expect(rendered).toMatch(/<h3|aria-level="3"/);
  });
});
```

---

## PART 11 — INFRASTRUCTURE

### Deployment Architecture

```
GitHub (source)
    │
    ├── Vercel (Remix app — auto-deploy on push to main)
    │       └── Custom domain: app.bundlekit.io
    │
    ├── Railway (PostgreSQL — production)
    │       └── Daily backups, connection pooling via PgBouncer
    │
    └── Shopify CLI (Extensions — deploy via GitHub Actions)
            └── shopify app deploy on release tag
```

### Environment Variables

```bash
# .env.example
SHOPIFY_API_KEY=
SHOPIFY_API_SECRET=
SHOPIFY_APP_URL=https://app.bundlekit.io
DATABASE_URL=postgresql://...
ENCRYPTION_KEY=  # For access token encryption at rest
NODE_ENV=production
```

### GitHub Actions: CI/CD

```yaml
# .github/workflows/deploy.yml
on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm test  # Must include ghost discount prevention test
      - run: npm run type-check

  deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npx shopify app deploy --force
        env:
          SHOPIFY_CLI_PARTNERS_TOKEN: ${{ secrets.SHOPIFY_CLI_TOKEN }}
```

---

## APPENDIX A — File Tree (Complete)

```
bundlekit/
├── app/                          # Remix application
│   ├── routes/
│   ├── services/
│   ├── models/
│   ├── components/
│   └── shopify.server.ts
├── extensions/
│   ├── discount-function/        # Rust Shopify Function
│   │   ├── src/main.rs
│   │   ├── schema.graphql
│   │   └── shopify.extension.toml
│   └── bundle-widget/            # Theme App Extension
│       ├── assets/
│       │   ├── bundle-widget.js
│       │   └── bundle-widget.css
│       └── blocks/
│           ├── quantity-breaks.liquid
│           ├── bundle-offer.liquid
│           └── progress-bar.liquid
├── prisma/
│   └── schema.prisma
├── public/
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
│       └── ghost-discount.test.ts  # Never skip this
├── .github/
│   └── workflows/
│       └── deploy.yml
├── shopify.app.toml
├── package.json
└── README.md
```

---

## APPENDIX B — USP → Technical Implementation Mapping

| USP Claim | Technical Implementation |
|---|---|
| "SEO-safe — zero H1 conflicts" | Web Component never emits `<h1>`. Enforced by lint rule + test. |
| "Discount accuracy guaranteed" | Shopify Functions + metafield sync. Ghost discount is architecturally impossible. |
| "No offer limits" | DB has no cap. Plan gates on GMV, not offer count. |
| "Built for Shopify certified" | Polaris + App Bridge + TAE + Functions = checklist complete. |
| "Works with any theme" | Theme App Extension served by Shopify CDN. CSS scoped to `.bk-*`. |
| "< 50ms widget render" | Web Component, < 12KB, sessionStorage cache, no framework. |

---

*Build plan version 1.0 — June 2026*
