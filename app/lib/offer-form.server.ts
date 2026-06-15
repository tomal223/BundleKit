/**
 * Shared server-side parsing for the offer form's JSON payload.
 */

import type { OfferInput, OfferType, TargetType } from "../services/offer.service";
import { OfferValidationError } from "../services/offer.service";
import { planAllowsOfferType } from "./plans.server";

interface OfferFormPayload {
  title?: unknown;
  message?: unknown;
  type?: unknown;
  targetType?: unknown;
  targetIds?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  status?: unknown;
  tiers?: unknown;
  // BOGO
  buyQty?: unknown;
  getQty?: unknown;
  getProductGid?: unknown;
  discountPct?: unknown;
  // Free gift
  threshold?: unknown;
  giftProductGid?: unknown;
  giftQty?: unknown;
}

function parseDate(value: unknown, endOfDay = false): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(`${value}T${endOfDay ? "23:59:59" : "00:00:00"}.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseOfferForm(payload: OfferFormPayload, plan: string): OfferInput {
  const type = String(payload.type ?? "quantity_break") as OfferType;

  if (!planAllowsOfferType(plan, type)) {
    throw new OfferValidationError(
      "This offer type isn't available on your current plan. Upgrade in Plan & settings.",
    );
  }

  const status = String(payload.status ?? "draft");
  const message = String(payload.message ?? "").trim();

  let config: Record<string, unknown>;
  switch (type) {
    case "bogo":
      config = {
        buyQty: Number(payload.buyQty),
        getQty: Number(payload.getQty),
        discountPct: Number(payload.discountPct ?? 100),
        ...(payload.getProductGid ? { getProductGid: String(payload.getProductGid) } : {}),
      };
      break;
    case "free_gift":
      config = {
        threshold: Number(payload.threshold),
        giftProductGid: String(payload.giftProductGid ?? ""),
        giftQty: Number(payload.giftQty ?? 1),
        discountPct: Number(payload.discountPct ?? 100),
      };
      break;
    case "bundle":
      config = {
        discountPct: Number(payload.discountPct),
      };
      break;
    default:
      config = {
        tiers: Array.isArray(payload.tiers)
          ? payload.tiers.map((tier) => ({
              qty: Number((tier as { qty: unknown }).qty),
              type: String((tier as { type: unknown }).type) as
                | "pct"
                | "flat"
                | "fixed_price",
              value: Number((tier as { value: unknown }).value),
            }))
          : [],
      };
  }

  if (message) config.message = message;

  return {
    type,
    title: String(payload.title ?? ""),
    status,
    targetType: String(payload.targetType ?? "all") as TargetType,
    targetIds: Array.isArray(payload.targetIds)
      ? payload.targetIds.map(String)
      : [],
    config,
    startsAt: parseDate(payload.startsAt),
    endsAt: parseDate(payload.endsAt, true),
  };
}
