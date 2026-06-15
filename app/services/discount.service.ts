/**
 * Manages the single automatic discount that backs ALL BundleKit offers.
 *
 * One discountAutomaticApp per shop → the Function evaluates every offer from
 * the metafield. Offer-level activation is controlled purely by metafield
 * content, never by creating/deleting Shopify discounts (avoids API races).
 */

import db from "../db.server";
import type { AdminGraphqlClient } from "./metafield.service";

export const FUNCTION_HANDLE = "bundlekit-discount";
export const DISCOUNT_TITLE = "BundleKit offers";

const CREATE_DISCOUNT_MUTATION = `#graphql
  mutation BundlekitCreateAutomaticDiscount($discount: DiscountAutomaticAppInput!) {
    discountAutomaticAppCreate(automaticAppDiscount: $discount) {
      automaticAppDiscount {
        discountId
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export class DiscountSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscountSetupError";
  }
}

/**
 * Idempotently ensures the shop has the BundleKit automatic discount.
 * Called when the first offer is activated.
 */
export async function ensureAutomaticDiscount(
  admin: AdminGraphqlClient,
  shopId: string,
): Promise<string> {
  const shop = await db.shop.findUniqueOrThrow({ where: { id: shopId } });
  if (shop.automaticDiscountGid) return shop.automaticDiscountGid;

  const response = await admin.graphql(CREATE_DISCOUNT_MUTATION, {
    variables: {
      discount: {
        title: DISCOUNT_TITLE,
        functionHandle: FUNCTION_HANDLE,
        discountClasses: ["PRODUCT"],
        startsAt: new Date().toISOString(),
        combinesWith: {
          orderDiscounts: true,
          productDiscounts: false,
          shippingDiscounts: true,
        },
      },
    },
  });

  const body = (await response.json()) as {
    data?: {
      discountAutomaticAppCreate?: {
        automaticAppDiscount?: { discountId?: string };
        userErrors?: Array<{ message: string }>;
      };
    };
  };

  const result = body.data?.discountAutomaticAppCreate;
  const errors = result?.userErrors ?? [];
  if (errors.length > 0) {
    throw new DiscountSetupError(
      `discountAutomaticAppCreate failed: ${errors.map((e) => e.message).join("; ")}`,
    );
  }
  const gid = result?.automaticAppDiscount?.discountId;
  if (!gid) throw new DiscountSetupError("No discount id returned");

  await db.shop.update({
    where: { id: shopId },
    data: { automaticDiscountGid: gid },
  });
  return gid;
}
