import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

/**
 * GDPR: customers/data_request
 *
 * BundleKit stores NO customer-level personal data. Analytics events are
 * shop/offer scoped (order ids and amounts only, no customer identifiers),
 * so there is no customer data to export. Acknowledging with 200 satisfies
 * the compliance contract; HMAC verification is performed by
 * authenticate.webhook (invalid signatures get a 401 automatically).
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop} — no customer PII stored`);

  return new Response();
};
