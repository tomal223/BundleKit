/**
 * AnalyticsService — event ingestion + daily aggregation.
 *
 * Widget views are recorded server-side by the app proxy endpoint (no PII,
 * no customer identifiers — keeps GDPR surface at zero).
 *
 * Revenue attribution via orders/paid requires the read_orders scope and
 * Shopify's protected customer data approval; recordOrderDiscount() is ready
 * for it — see webhooks notes in shopify.app.toml before enabling.
 */

import db from "../db.server";

function dayStart(date = new Date()): Date {
  const day = new Date(date);
  day.setUTCHours(0, 0, 0, 0);
  return day;
}

/** Increment view counters for the offers a storefront visitor was shown. */
export async function recordOfferViews(shopId: string, offerIds: string[]) {
  const date = dayStart();
  for (const offerId of offerIds) {
    await db.analyticsDaily.upsert({
      where: { shopId_offerId_date: { shopId, offerId, date } },
      update: { views: { increment: 1 } },
      create: { shopId, offerId, date, views: 1 },
    });
  }
}

/** Record a discount application from an order (used once orders/paid is enabled). */
export async function recordOrderDiscount(
  shopId: string,
  offerId: string,
  orderId: string,
  baseAmount: number,
  discountAmount: number,
  currency: string,
) {
  await db.analyticsEvent.create({
    data: {
      shopId,
      offerId,
      eventType: "discount_applied",
      orderId,
      baseAmount,
      discountAmount,
      currency,
    },
  });
  const date = dayStart();
  await db.analyticsDaily.upsert({
    where: { shopId_offerId_date: { shopId, offerId, date } },
    update: {
      discountsApplied: { increment: 1 },
      discountTotal: { increment: discountAmount },
      revenueAttributed: { increment: baseAmount },
    },
    create: {
      shopId,
      offerId,
      date,
      discountsApplied: 1,
      discountTotal: discountAmount,
      revenueAttributed: baseAmount,
    },
  });
}

export interface OfferStats {
  offerId: string;
  title: string;
  status: string;
  views: number;
  discountsApplied: number;
  discountTotal: number;
  revenueAttributed: number;
}

export interface ShopStats {
  totals: {
    views: number;
    discountsApplied: number;
    discountTotal: number;
    revenueAttributed: number;
  };
  byOffer: OfferStats[];
}

/** Aggregated stats for the dashboard (default: last 30 days). */
export async function getShopStats(shopId: string, days = 30): Promise<ShopStats> {
  const since = dayStart(new Date(Date.now() - days * 24 * 60 * 60 * 1000));

  const rows = await db.analyticsDaily.findMany({
    where: { shopId, date: { gte: since } },
    include: { offer: { select: { title: true, status: true } } },
  });

  const byOfferMap = new Map<string, OfferStats>();
  const totals = { views: 0, discountsApplied: 0, discountTotal: 0, revenueAttributed: 0 };

  for (const row of rows) {
    const discountTotal = Number(row.discountTotal);
    const revenue = Number(row.revenueAttributed);

    totals.views += row.views;
    totals.discountsApplied += row.discountsApplied;
    totals.discountTotal += discountTotal;
    totals.revenueAttributed += revenue;

    const existing = byOfferMap.get(row.offerId) ?? {
      offerId: row.offerId,
      title: row.offer.title,
      status: row.offer.status,
      views: 0,
      discountsApplied: 0,
      discountTotal: 0,
      revenueAttributed: 0,
    };
    existing.views += row.views;
    existing.discountsApplied += row.discountsApplied;
    existing.discountTotal += discountTotal;
    existing.revenueAttributed += revenue;
    byOfferMap.set(row.offerId, existing);
  }

  return {
    totals,
    byOffer: [...byOfferMap.values()].sort((a, b) => b.views - a.views),
  };
}
