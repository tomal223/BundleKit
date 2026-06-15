import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Link, useFetcher, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { ensureShop } from "../models/shop.server";
import {
  activateOffer,
  deleteOffer,
  listOffers,
  pauseOffer,
} from "../services/offer.service";
import { ensureAutomaticDiscount } from "../services/discount.service";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const offers = await listOffers(shop.id);
  return {
    offers: offers.map((offer) => ({
      id: offer.id,
      title: offer.title,
      type: offer.type,
      status: offer.status,
      targetType: offer.targetType,
      updatedAt: offer.updatedAt.toISOString(),
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const formData = await request.formData();
  const intent = String(formData.get("intent"));
  const offerId = String(formData.get("offerId"));

  switch (intent) {
    case "activate":
      await ensureAutomaticDiscount(admin, shop.id);
      await activateOffer(admin, offerId, shop.id);
      return { ok: true, message: "Offer activated" };
    case "pause":
      await pauseOffer(admin, offerId, shop.id);
      return {
        ok: true,
        message: "Offer paused — removed from checkout immediately",
      };
    case "delete":
      await deleteOffer(admin, offerId, shop.id);
      return { ok: true, message: "Offer deleted" };
    default:
      return { ok: false, message: "Unknown action" };
  }
};

const TYPE_LABELS: Record<string, string> = {
  quantity_break: "Quantity break",
  bogo: "BOGO",
  bundle: "Bundle",
  free_gift: "Free gift",
};

const STATUS_TONE: Record<string, "success" | "info" | "warning" | "neutral"> =
  {
    active: "success",
    draft: "info",
    paused: "warning",
    scheduled: "info",
    expired: "neutral",
  };

export default function OffersIndex() {
  const { offers } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";

  return (
    <s-page heading="Offers">
      <s-link slot="primary-action" href="/app/offers/new">
        <s-button variant="primary">Create offer</s-button>
      </s-link>

      {offers.length === 0 ? (
        <s-section heading="Create your first offer">
          <s-paragraph>
            BundleKit boosts your average order value with quantity breaks,
            BOGO deals, bundles, and free gifts — all applied automatically at
            checkout.
          </s-paragraph>
          <s-unordered-list>
            <s-list-item>
              <s-text type="strong">1. Create an offer</s-text> — pick a
              discount type and set your tiers.
            </s-list-item>
            <s-list-item>
              <s-text type="strong">2. Add the widget</s-text> — in your
              theme editor, add the BundleKit block to your product page.
            </s-list-item>
            <s-list-item>
              <s-text type="strong">3. Activate</s-text> — discounts apply
              instantly at checkout. Pause anytime; paused offers stop
              immediately.
            </s-list-item>
          </s-unordered-list>
          <s-link href="/app/offers/new">
            <s-button variant="primary">Create offer</s-button>
          </s-link>
        </s-section>
      ) : (
        <s-section>
          <s-table>
            <s-table-header-row>
              <s-table-header>Offer</s-table-header>
              <s-table-header>Type</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Actions</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {offers.map((offer) => (
                <s-table-row key={offer.id}>
                  <s-table-cell>
                    <Link to={`/app/offers/${offer.id}`}>{offer.title}</Link>
                  </s-table-cell>
                  <s-table-cell>
                    {TYPE_LABELS[offer.type] ?? offer.type}
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge tone={STATUS_TONE[offer.status] ?? "neutral"}>
                      {offer.status}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    <s-button-group>
                      {offer.status === "active" ? (
                        <fetcher.Form method="post" style={{ display: "inline" }}>
                          <input type="hidden" name="intent" value="pause" />
                          <input type="hidden" name="offerId" value={offer.id} />
                          <s-button type="submit" disabled={busy ? true : undefined}>
                            Pause
                          </s-button>
                        </fetcher.Form>
                      ) : (
                        <fetcher.Form method="post" style={{ display: "inline" }}>
                          <input type="hidden" name="intent" value="activate" />
                          <input type="hidden" name="offerId" value={offer.id} />
                          <s-button
                            type="submit"
                            variant="primary"
                            disabled={busy ? true : undefined}
                          >
                            Activate
                          </s-button>
                        </fetcher.Form>
                      )}
                      <fetcher.Form method="post" style={{ display: "inline" }}>
                        <input type="hidden" name="intent" value="delete" />
                        <input type="hidden" name="offerId" value={offer.id} />
                        <s-button
                          tone="critical"
                          type="submit"
                          disabled={busy ? true : undefined}
                        >
                          Delete
                        </s-button>
                      </fetcher.Form>
                    </s-button-group>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      )}
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
