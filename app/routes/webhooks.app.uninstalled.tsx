import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { markShopUninstalled } from "../models/shop.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    // Delete all sessions (and the access tokens they contain) immediately.
    await db.session.deleteMany({ where: { shop } });
  }

  // Mark the shop uninstalled; full data deletion happens via shop/redact.
  await markShopUninstalled(shop);

  return new Response();
};
