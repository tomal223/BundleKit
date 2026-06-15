import { describe, it, expect, afterAll } from "vitest";
import db from "../../app/db.server";
import {
  ensureShop,
  getShopByDomain,
  markShopUninstalled,
  redactShop,
} from "../../app/models/shop.server";

const DOMAIN = "vitest-shop.myshopify.com";

afterAll(async () => {
  await db.shop.deleteMany({ where: { shopDomain: DOMAIN } });
});

describe("shop lifecycle", () => {
  it("ensureShop creates a shop with free plan defaults", async () => {
    const shop = await ensureShop(DOMAIN);
    expect(shop.shopDomain).toBe(DOMAIN);
    expect(shop.plan).toBe("free");
    expect(shop.uninstalledAt).toBeNull();
  });

  it("ensureShop is idempotent and clears uninstalledAt on reinstall", async () => {
    await markShopUninstalled(DOMAIN);
    const before = await getShopByDomain(DOMAIN);
    expect(before?.uninstalledAt).not.toBeNull();

    const shop = await ensureShop(DOMAIN);
    expect(shop.uninstalledAt).toBeNull();

    // No duplicate rows
    const count = await db.shop.count({ where: { shopDomain: DOMAIN } });
    expect(count).toBe(1);
  });

  it("redactShop cascades: offers and analytics are deleted with the shop", async () => {
    const shop = await ensureShop(DOMAIN);
    const offer = await db.offer.create({
      data: {
        shopId: shop.id,
        type: "quantity_break",
        status: "active",
        title: "Test offer",
        targetType: "all",
        config: JSON.stringify({ tiers: [{ qty: 2, type: "pct", value: 10 }] }),
      },
    });
    await db.analyticsEvent.create({
      data: { shopId: shop.id, offerId: offer.id, eventType: "offer_viewed" },
    });

    await redactShop(DOMAIN);

    expect(await getShopByDomain(DOMAIN)).toBeNull();
    expect(await db.offer.count({ where: { shopId: shop.id } })).toBe(0);
    expect(
      await db.analyticsEvent.count({ where: { shopId: shop.id } }),
    ).toBe(0);
  });
});
