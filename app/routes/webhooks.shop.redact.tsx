import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { redactShop } from "../models/shop.server";

/**
 * GDPR: shop/redact
 *
 * Sent ~48 hours after uninstall. Irreversibly deletes ALL data for the shop:
 * the Shop row cascades to offers, analytics events, and daily aggregates.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop} — deleting all shop data`);

  await redactShop(shop);

  return new Response();
};
