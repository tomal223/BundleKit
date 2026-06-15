/**
 * BundleKit pricing — GMV-aligned plans, NO offer-count caps.
 * Billing goes exclusively through the Shopify Billing API.
 */

import { BillingInterval } from "@shopify/shopify-app-react-router/server";
import type { OfferType } from "../services/offer.service";

export const PLAN_GROWTH = "Growth";
export const PLAN_PRO = "Pro";

interface RecurringPlanConfig {
  trialDays?: number;
  lineItems: Array<{
    amount: number;
    currencyCode: string;
    interval: BillingInterval.Every30Days | BillingInterval.Annual;
  }>;
}

export const billingConfig: Record<string, RecurringPlanConfig> = {
  [PLAN_GROWTH]: {
    lineItems: [
      {
        amount: 14.99,
        currencyCode: "USD",
        interval: BillingInterval.Every30Days,
      },
    ],
    trialDays: 14,
  },
  [PLAN_PRO]: {
    lineItems: [
      {
        amount: 29.99,
        currencyCode: "USD",
        interval: BillingInterval.Every30Days,
      },
    ],
    trialDays: 14,
  },
};

export type PlanName = "free" | typeof PLAN_GROWTH | typeof PLAN_PRO;

/** Offer types available per plan (cumulative). */
const PLAN_OFFER_TYPES: Record<string, OfferType[]> = {
  free: ["quantity_break"],
  [PLAN_GROWTH]: ["quantity_break", "bogo", "free_gift"],
  [PLAN_PRO]: ["quantity_break", "bogo", "free_gift", "bundle"],
};

export function offerTypesForPlan(plan: string): OfferType[] {
  return PLAN_OFFER_TYPES[plan] ?? PLAN_OFFER_TYPES.free;
}

export function planAllowsOfferType(plan: string, type: OfferType): boolean {
  return offerTypesForPlan(plan).includes(type);
}

export const PLAN_DETAILS = [
  {
    name: "free" as const,
    label: "Free",
    price: "$0",
    features: ["Quantity break offers", "Storefront widget", "Up to $500 bundled GMV/mo"],
  },
  {
    name: PLAN_GROWTH,
    label: "Growth",
    price: "$14.99/mo",
    features: ["Everything in Free", "BOGO + Free Gift offers", "Progress bar", "Up to $10K bundled GMV/mo"],
  },
  {
    name: PLAN_PRO,
    label: "Pro",
    price: "$29.99/mo",
    features: ["Everything in Growth", "Bundle builder", "Unlimited GMV", "Priority support"],
  },
];
