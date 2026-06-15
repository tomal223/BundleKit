import db from "../db.server";

/**
 * Idempotently ensures a Shop row exists for the given myshopify domain.
 * Called from the afterAuth hook — also clears `uninstalledAt` on reinstall.
 */
export async function ensureShop(shopDomain: string) {
  return db.shop.upsert({
    where: { shopDomain },
    update: { uninstalledAt: null },
    create: { shopDomain },
  });
}

export async function getShopByDomain(shopDomain: string) {
  return db.shop.findUnique({ where: { shopDomain } });
}

/**
 * Marks a shop uninstalled. Offer/analytics data is retained until the
 * mandatory `shop/redact` webhook arrives (~48h later), which fully deletes it.
 */
export async function markShopUninstalled(shopDomain: string) {
  await db.shop.updateMany({
    where: { shopDomain },
    data: { uninstalledAt: new Date() },
  });
}

/**
 * GDPR shop/redact: irreversibly deletes all data for the shop.
 * Cascades to offers, analytics events, and daily aggregates.
 */
export async function redactShop(shopDomain: string) {
  await db.shop.deleteMany({ where: { shopDomain } });
}
