/**
 * OfferService — CRUD with mandatory metafield sync.
 *
 * INVARIANT (ghost discount prevention): every mutation that can change which
 * offers are live MUST be followed by syncShopOffers() before returning.
 * The metafield is the single source the checkout Function reads; if an offer
 * is not in the metafield, it cannot discount anything.
 */

import type { Offer } from "@prisma/client";
import db from "../db.server";
import {
  type AdminGraphqlClient,
  fetchShopGid,
  writeOffersMetafield,
} from "./metafield.service";

export const OFFER_TYPES = ["quantity_break", "bogo", "bundle", "free_gift"] as const;
export const OFFER_STATUSES = ["draft", "active", "paused", "scheduled", "expired"] as const;
export const TARGET_TYPES = ["all", "product", "collection", "variant"] as const;
export const TIER_TYPES = ["pct", "flat", "fixed_price"] as const;

export type OfferType = (typeof OFFER_TYPES)[number];
export type TargetType = (typeof TARGET_TYPES)[number];

export interface Tier {
  qty: number;
  type: (typeof TIER_TYPES)[number];
  value: number;
}

export interface OfferInput {
  type: OfferType;
  title: string;
  status?: string;
  targetType: TargetType;
  targetIds?: string[];
  config: Record<string, unknown>;
  startsAt?: Date | null;
  endsAt?: Date | null;
  priority?: number;
}

export class OfferValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OfferValidationError";
  }
}

export function validateOfferInput(input: OfferInput): void {
  if (!OFFER_TYPES.includes(input.type)) {
    throw new OfferValidationError(`Unknown offer type: ${input.type}`);
  }
  if (!input.title?.trim()) {
    throw new OfferValidationError("Title is required");
  }
  if (!TARGET_TYPES.includes(input.targetType)) {
    throw new OfferValidationError(`Unknown target type: ${input.targetType}`);
  }
  if (input.targetType !== "all" && !(input.targetIds?.length ?? 0)) {
    throw new OfferValidationError("Select at least one target");
  }
  if (input.status && !OFFER_STATUSES.includes(input.status as never)) {
    throw new OfferValidationError(`Unknown status: ${input.status}`);
  }
  if (input.startsAt && input.endsAt && input.startsAt >= input.endsAt) {
    throw new OfferValidationError("End date must be after start date");
  }

  switch (input.type) {
    case "quantity_break":
      validateQuantityBreakConfig(input.config);
      break;
    case "bogo":
      validateBogoConfig(input.config);
      break;
    case "free_gift":
      validateFreeGiftConfig(input.config);
      break;
    case "bundle":
      validateBundleConfig(input);
      break;
  }
}

function validateQuantityBreakConfig(config: Record<string, unknown>): void {
  const tiers = config?.tiers as Tier[] | undefined;
  if (!Array.isArray(tiers) || tiers.length === 0) {
    throw new OfferValidationError("Quantity break offers need at least one tier");
  }
  const seen = new Set<number>();
  for (const tier of tiers) {
    if (!Number.isInteger(tier.qty) || tier.qty < 1) {
      throw new OfferValidationError("Tier quantity must be a whole number ≥ 1");
    }
    if (seen.has(tier.qty)) {
      throw new OfferValidationError(`Duplicate tier quantity: ${tier.qty}`);
    }
    seen.add(tier.qty);
    if (!TIER_TYPES.includes(tier.type)) {
      throw new OfferValidationError(`Unknown tier type: ${tier.type}`);
    }
    if (!Number.isFinite(tier.value) || tier.value <= 0) {
      throw new OfferValidationError("Tier value must be greater than zero");
    }
    if (tier.type === "pct" && tier.value > 100) {
      throw new OfferValidationError("Percentage discount cannot exceed 100");
    }
  }
}

function validatePct(value: unknown, label: string): void {
  const pct = Number(value);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
    throw new OfferValidationError(`${label} must be between 1 and 100`);
  }
}

function validateBogoConfig(config: Record<string, unknown>): void {
  const buyQty = Number(config.buyQty);
  const getQty = Number(config.getQty);
  if (!Number.isInteger(buyQty) || buyQty < 1) {
    throw new OfferValidationError("Buy quantity must be a whole number ≥ 1");
  }
  if (!Number.isInteger(getQty) || getQty < 1) {
    throw new OfferValidationError("Get quantity must be a whole number ≥ 1");
  }
  validatePct(config.discountPct ?? 100, "BOGO discount");
  if (
    config.getProductGid != null &&
    config.getProductGid !== "" &&
    typeof config.getProductGid !== "string"
  ) {
    throw new OfferValidationError("Invalid get-product");
  }
}

function validateFreeGiftConfig(config: Record<string, unknown>): void {
  const threshold = Number(config.threshold);
  if (!Number.isFinite(threshold) || threshold <= 0) {
    throw new OfferValidationError("Spend threshold must be greater than zero");
  }
  if (typeof config.giftProductGid !== "string" || !config.giftProductGid) {
    throw new OfferValidationError("Select a gift product");
  }
  const giftQty = Number(config.giftQty ?? 1);
  if (!Number.isInteger(giftQty) || giftQty < 1) {
    throw new OfferValidationError("Gift quantity must be a whole number ≥ 1");
  }
  validatePct(config.discountPct ?? 100, "Gift discount");
}

function validateBundleConfig(input: OfferInput): void {
  if (input.targetType !== "product" || (input.targetIds?.length ?? 0) < 2) {
    throw new OfferValidationError("Bundles need at least two specific products");
  }
  validatePct(input.config.discountPct, "Bundle discount");
}

/** Shape written to the metafield for the Function to consume. */
export function serializeOfferForFunction(
  offer: Offer,
  expandedTargetIds?: string[],
) {
  return {
    id: offer.id,
    type: offer.type,
    status: offer.status,
    title: offer.title,
    targetType: offer.targetType,
    targetIds: expandedTargetIds ?? (JSON.parse(offer.targetIds) as string[]),
    config: JSON.parse(offer.config) as Record<string, unknown>,
    startsAt: offer.startsAt?.toISOString() ?? null,
    endsAt: offer.endsAt?.toISOString() ?? null,
    priority: offer.priority,
  };
}

/**
 * Storefront matching: does this offer apply to the given product/variant?
 * Uses the expandedTargetIds cache (collections already resolved to products).
 */
export function offerMatchesProduct(
  offer: Pick<Offer, "targetType" | "expandedTargetIds">,
  productGid: string,
  variantGid?: string | null,
): boolean {
  if (offer.targetType === "all") return true;
  const targets = JSON.parse(offer.expandedTargetIds) as string[];
  if (offer.targetType === "variant") {
    return !!variantGid && targets.includes(variantGid);
  }
  return targets.includes(productGid);
}

/** Public payload for the storefront widget — no internal fields. */
export function serializeOfferForStorefront(offer: Offer) {
  return {
    id: offer.id,
    type: offer.type,
    title: offer.title,
    config: JSON.parse(offer.config) as Record<string, unknown>,
    priority: offer.priority,
  };
}

export async function getActiveOffersForProduct(
  shopId: string,
  productGid: string,
  variantGid?: string | null,
) {
  const now = new Date();
  const offers = await db.offer.findMany({
    where: {
      shopId,
      status: "active",
      AND: [
        { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
      ],
    },
    orderBy: { priority: "asc" },
  });
  return offers.filter((offer) => offerMatchesProduct(offer, productGid, variantGid));
}

export async function listOffers(shopId: string) {
  return db.offer.findMany({
    where: { shopId },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
  });
}

export async function getOffer(id: string, shopId: string) {
  return db.offer.findFirst({ where: { id, shopId } });
}

export async function createOffer(
  admin: AdminGraphqlClient,
  shopId: string,
  input: OfferInput,
) {
  validateOfferInput(input);
  const offer = await db.offer.create({
    data: {
      shopId,
      type: input.type,
      status: input.status ?? "draft",
      title: input.title.trim(),
      targetType: input.targetType,
      targetIds: JSON.stringify(input.targetIds ?? []),
      config: JSON.stringify(input.config),
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
      priority: input.priority ?? 0,
    },
  });
  await syncShopOffers(admin, shopId); // ALWAYS sync after mutation
  return offer;
}

export async function updateOffer(
  admin: AdminGraphqlClient,
  id: string,
  shopId: string,
  input: OfferInput,
) {
  validateOfferInput(input);
  const offer = await db.offer.update({
    where: { id, shopId },
    data: {
      type: input.type,
      status: input.status ?? undefined,
      title: input.title.trim(),
      targetType: input.targetType,
      targetIds: JSON.stringify(input.targetIds ?? []),
      config: JSON.stringify(input.config),
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
      priority: input.priority ?? 0,
    },
  });
  await syncShopOffers(admin, shopId);
  return offer;
}

export async function activateOffer(admin: AdminGraphqlClient, id: string, shopId: string) {
  const offer = await db.offer.update({
    where: { id, shopId },
    data: { status: "active" },
  });
  await syncShopOffers(admin, shopId);
  return offer;
}

/**
 * Pausing syncs IMMEDIATELY — this is the ghost discount prevention.
 * After this resolves, the offer no longer exists in the metafield and the
 * Function cannot apply it at the next checkout evaluation.
 */
export async function pauseOffer(admin: AdminGraphqlClient, id: string, shopId: string) {
  const offer = await db.offer.update({
    where: { id, shopId },
    data: { status: "paused" },
  });
  await syncShopOffers(admin, shopId);
  return offer;
}

export async function deleteOffer(admin: AdminGraphqlClient, id: string, shopId: string) {
  await db.offer.delete({ where: { id, shopId } });
  await syncShopOffers(admin, shopId); // removes it from the metafield
}

/**
 * Core sync: writes ONLY active, in-window offers to the shop metafield.
 * Collection targets are expanded to product GIDs so the Function never
 * needs collection membership lookups at checkout.
 */
export async function syncShopOffers(admin: AdminGraphqlClient, shopId: string) {
  const shop = await db.shop.findUniqueOrThrow({ where: { id: shopId } });
  const now = new Date();

  const activeOffers = await db.offer.findMany({
    where: {
      shopId,
      status: "active",
      AND: [
        { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
      ],
    },
    orderBy: { priority: "asc" },
  });

  const serialized = [];
  for (const offer of activeOffers) {
    if (offer.targetType === "collection") {
      const collectionIds = JSON.parse(offer.targetIds) as string[];
      const productIds = await expandCollectionsToProductIds(admin, collectionIds);
      await db.offer.update({
        where: { id: offer.id },
        data: { expandedTargetIds: JSON.stringify(productIds) },
      });
      serialized.push(serializeOfferForFunction(offer, productIds));
    } else {
      await db.offer.update({
        where: { id: offer.id },
        data: { expandedTargetIds: offer.targetIds },
      });
      serialized.push(serializeOfferForFunction(offer));
    }
  }

  let shopGid = shop.shopifyShopGid;
  if (!shopGid) {
    shopGid = await fetchShopGid(admin);
    await db.shop.update({ where: { id: shopId }, data: { shopifyShopGid: shopGid } });
  }

  await writeOffersMetafield(admin, shopGid, serialized);

  const syncedAt = new Date();
  await db.shop.update({ where: { id: shopId }, data: { metafieldSyncedAt: syncedAt } });
  await db.offer.updateMany({ where: { shopId }, data: { metafieldSyncedAt: syncedAt } });
}

const COLLECTION_PRODUCTS_QUERY = `#graphql
  query BundlekitCollectionProducts($id: ID!, $cursor: String) {
    collection(id: $id) {
      products(first: 250, after: $cursor) {
        nodes {
          id
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

async function expandCollectionsToProductIds(
  admin: AdminGraphqlClient,
  collectionIds: string[],
): Promise<string[]> {
  const productIds = new Set<string>();
  for (const id of collectionIds) {
    let cursor: string | null = null;
    do {
      const response = await admin.graphql(COLLECTION_PRODUCTS_QUERY, {
        variables: { id, cursor },
      });
      const body = (await response.json()) as {
        data?: {
          collection?: {
            products?: {
              nodes: Array<{ id: string }>;
              pageInfo: { hasNextPage: boolean; endCursor: string | null };
            };
          };
        };
      };
      const products = body.data?.collection?.products;
      if (!products) break;
      for (const node of products.nodes) productIds.add(node.id);
      cursor = products.pageInfo.hasNextPage ? products.pageInfo.endCursor : null;
    } while (cursor);
  }
  return [...productIds];
}
