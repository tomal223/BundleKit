import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getShopByDomain } from "../models/shop.server";
import db from "../db.server";
import { recordOrderDiscount } from "../services/analytics.service";

/**
 * orders/paid — revenue attribution for the analytics dashboard.
 *
 * NOT SUBSCRIBED BY DEFAULT. Enabling this requires:
 *   1. Adding `read_orders` to scopes in shopify.app.toml
 *   2. Requesting Protected Customer Data access in the Partner Dashboard
 *   3. Subscribing: topics = ["orders/paid"], uri = "/webhooks/orders/paid"
 * Until then the route is inert (Shopify never calls it) and the app stays
 * scope-minimal for review.
 *
 * Attribution strategy: match the order's automatic discount application
 * titles against offer messages/titles. No customer data is stored.
 */

interface OrdersPaidPayload {
  id?: number | string;
  currency?: string;
  discount_applications?: Array<{
    type?: string;
    title?: string;
    description?: string;
  }>;
  current_subtotal_price?: string;
  total_discounts?: string;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop: shopDomain, topic, payload } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shopDomain}`);

  const shop = await getShopByDomain(shopDomain);
  if (!shop) return new Response();

  const order = payload as OrdersPaidPayload;
  const applications = order.discount_applications ?? [];
  if (!applications.length) return new Response();

  const offers = await db.offer.findMany({ where: { shopId: shop.id } });

  for (const application of applications) {
    if (application.type !== "automatic") continue;
    const label = application.title ?? application.description ?? "";
    const offer = offers.find((candidate) => {
      const config = JSON.parse(candidate.config) as { message?: string };
      return (config.message ?? candidate.title) === label;
    });
    if (!offer) continue;

    await recordOrderDiscount(
      shop.id,
      offer.id,
      String(order.id ?? ""),
      Number(order.current_subtotal_price ?? 0),
      Number(order.total_discounts ?? 0),
      order.currency ?? "USD",
    );
  }

  return new Response();
};
