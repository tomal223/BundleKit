import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

/**
 * GDPR: customers/redact
 *
 * BundleKit stores no customer-level personal data (see data_request handler),
 * so there is nothing to redact. If customer-scoped analytics are ever added,
 * deletion logic MUST be implemented here before release.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop} — no customer PII stored`);

  return new Response();
};
