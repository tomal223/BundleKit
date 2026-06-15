/**
 * GHOST DISCOUNT PREVENTION — the critical test. NEVER delete or skip.
 *
 * Full pipeline: OfferService mutation → metafield sync (mocked Shopify
 * Admin captures the exact payload that would be written) → discount
 * Function executes against that payload → discounts asserted.
 *
 * Proves the architectural guarantee: a paused/deleted offer is removed from
 * the metafield in the same operation, so the Function (which only reads the
 * metafield) can never apply it.
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import db from "../../app/db.server";
import {
  createOffer,
  activateOffer,
  pauseOffer,
  deleteOffer,
  syncShopOffers,
} from "../../app/services/offer.service";
import type { AdminGraphqlClient } from "../../app/services/metafield.service";
// Plain JS module from the function extension — typed loosely here.
import { cartLinesDiscountsGenerateRun as runFunction } from "../../extensions/bundlekit-discount/src/cart_lines_discounts_generate_run";

type FunctionResult = {
  operations: Array<{
    productDiscountsAdd: {
      candidates: Array<{ value: unknown }>;
      selectionStrategy: string;
    };
  }>;
};

const cartLinesDiscountsGenerateRun = runFunction as (
  input: unknown,
) => FunctionResult;

const DOMAIN = "ghost-test.myshopify.com";
const SHOP_GID = "gid://shopify/Shop/777";

/** Mock Admin API that records every metafieldsSet payload. */
function makeAdminMock() {
  const writes: Array<{ namespace: string; key: string; value: string }> = [];
  const admin: AdminGraphqlClient = {
    graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => {
      let data: unknown;
      if (query.includes("metafieldsSet")) {
        const metafields = (options?.variables?.metafields ?? []) as Array<{
          namespace: string;
          key: string;
          value: string;
        }>;
        writes.push(...metafields);
        data = { metafieldsSet: { metafields: [{ id: "gid://shopify/Metafield/1" }], userErrors: [] } };
      } else if (query.includes("shop")) {
        data = { shop: { id: SHOP_GID } };
      } else {
        data = {};
      }
      return new Response(JSON.stringify({ data }), {
        headers: { "Content-Type": "application/json" },
      });
    },
  };
  return { admin, writes };
}

function lastMetafieldValue(writes: Array<{ value: string }>) {
  expect(writes.length).toBeGreaterThan(0);
  return JSON.parse(writes[writes.length - 1].value) as { v: number; offers: Array<{ id: string }> };
}

function checkoutInput(metafieldPayload: unknown, quantity: number) {
  return {
    cart: {
      lines: [
        {
          id: "gid://shopify/CartLine/1",
          quantity,
          cost: { amountPerQuantity: { amount: "25.00" } },
          merchandise: {
            __typename: "ProductVariant",
            id: "gid://shopify/ProductVariant/11",
            product: { id: "gid://shopify/Product/111" },
          },
        },
      ],
    },
    shop: { metafield: { value: JSON.stringify(metafieldPayload) } },
    discount: { discountClasses: ["PRODUCT"] },
  };
}

let shopId: string;

beforeEach(async () => {
  await db.shop.deleteMany({ where: { shopDomain: DOMAIN } });
  const shop = await db.shop.create({ data: { shopDomain: DOMAIN } });
  shopId = shop.id;
});

afterAll(async () => {
  await db.shop.deleteMany({ where: { shopDomain: DOMAIN } });
});

describe("Ghost Discount Prevention", () => {
  it("deactivated offer NEVER applies a discount at checkout", async () => {
    const { admin, writes } = makeAdminMock();

    // 1. Create + activate a quantity break offer
    const offer = await createOffer(admin, shopId, {
      type: "quantity_break",
      title: "Buy 3 Save 20%",
      targetType: "all",
      config: { tiers: [{ qty: 3, type: "pct", value: 20 }] },
    });
    await activateOffer(admin, offer.id, shopId);

    // 2. Metafield contains the offer; Function applies the discount
    let payload = lastMetafieldValue(writes);
    expect(payload.offers.map((o) => o.id)).toContain(offer.id);

    let result = cartLinesDiscountsGenerateRun(checkoutInput(payload, 3));
    expect(result.operations).toHaveLength(1);
    expect(
      result.operations[0].productDiscountsAdd.candidates[0].value,
    ).toEqual({ percentage: { value: 20 } });

    // 3. Pause the offer
    await pauseOffer(admin, offer.id, shopId);

    // 4. Metafield no longer contains the offer
    payload = lastMetafieldValue(writes);
    expect(payload.offers.map((o) => o.id)).not.toContain(offer.id);

    // 5. Function applies ZERO discounts
    result = cartLinesDiscountsGenerateRun(checkoutInput(payload, 3));
    expect(result.operations).toEqual([]);
  });

  it("deleted offer is removed from the metafield in the same operation", async () => {
    const { admin, writes } = makeAdminMock();

    const offer = await createOffer(admin, shopId, {
      type: "quantity_break",
      title: "Bulk deal",
      targetType: "product",
      targetIds: ["gid://shopify/Product/111"],
      config: { tiers: [{ qty: 2, type: "pct", value: 10 }] },
      status: "active",
    });

    expect(lastMetafieldValue(writes).offers.map((o) => o.id)).toContain(offer.id);

    await deleteOffer(admin, offer.id, shopId);

    const payload = lastMetafieldValue(writes);
    expect(payload.offers).toHaveLength(0);
    expect(
      cartLinesDiscountsGenerateRun(checkoutInput(payload, 5)).operations,
    ).toEqual([]);
  });

  it("expired offers are excluded from sync", async () => {
    const { admin, writes } = makeAdminMock();

    await createOffer(admin, shopId, {
      type: "quantity_break",
      title: "Expired deal",
      targetType: "all",
      config: { tiers: [{ qty: 2, type: "pct", value: 50 }] },
      status: "active",
      startsAt: new Date("2026-01-01T00:00:00Z"),
      endsAt: new Date("2026-02-01T00:00:00Z"),
    });

    await syncShopOffers(admin, shopId);
    expect(lastMetafieldValue(writes).offers).toHaveLength(0);
  });

  it("draft offers are never synced", async () => {
    const { admin, writes } = makeAdminMock();

    await createOffer(admin, shopId, {
      type: "quantity_break",
      title: "Draft deal",
      targetType: "all",
      config: { tiers: [{ qty: 2, type: "pct", value: 15 }] },
      // status defaults to draft
    });

    expect(lastMetafieldValue(writes).offers).toHaveLength(0);
  });
});
