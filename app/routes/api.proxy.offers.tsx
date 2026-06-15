/**
 * Public storefront endpoint (App Proxy): /apps/bundlekit/offers
 *
 * Shopify forwards the request here after verifying it originates from the
 * storefront; authenticate.public.appProxy() validates the HMAC signature.
 * Returns ONLY active, in-window offers for the requested product — the same
 * filter the metafield sync uses, so the widget never displays a dead offer.
 */

import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getShopByDomain } from "../models/shop.server";
import {
  getActiveOffersForProduct,
  serializeOfferForStorefront,
} from "../services/offer.service";
import { recordOfferViews } from "../services/analytics.service";

const JSON_HEADERS = {
  "Content-Type": "application/json",
  // Short cache: storefront display only. Checkout accuracy is enforced by
  // the Function + metafield, never by this endpoint.
  "Cache-Control": "public, max-age=30",
};

function emptyResponse(status = 200) {
  return new Response(JSON.stringify({ offers: [] }), {
    status,
    headers: JSON_HEADERS,
  });
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  if (!session) return emptyResponse();

  const url = new URL(request.url);
  const productId = url.searchParams.get("product_id");
  const variantId = url.searchParams.get("variant_id");
  if (!productId || !productId.startsWith("gid://shopify/Product/")) {
    return emptyResponse(400);
  }

  const shop = await getShopByDomain(session.shop);
  if (!shop || shop.uninstalledAt) return emptyResponse();

  const offers = await getActiveOffersForProduct(shop.id, productId, variantId);

  if (offers.length) {
    // Fire-and-forget view tracking — never block or fail the response.
    recordOfferViews(shop.id, offers.map((offer) => offer.id)).catch(() => {});
  }

  return new Response(
    JSON.stringify({ offers: offers.map(serializeOfferForStorefront) }),
    { headers: JSON_HEADERS },
  );
};
