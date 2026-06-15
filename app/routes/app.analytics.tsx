import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { ensureShop } from "../models/shop.server";
import { getShopStats } from "../services/analytics.service";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const stats = await getShopStats(shop.id, 30);
  return { stats };
};

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

export default function Analytics() {
  const { stats } = useLoaderData<typeof loader>();
  const hasData = stats.totals.views > 0 || stats.totals.discountsApplied > 0;

  return (
    <s-page heading="Analytics — last 30 days">
      <s-section heading="Overview">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))" gap="base">
          <s-box padding="base" borderRadius="base" borderWidth="base">
            <s-text>Widget views</s-text>
            <s-heading>{String(stats.totals.views)}</s-heading>
          </s-box>
          <s-box padding="base" borderRadius="base" borderWidth="base">
            <s-text>Discounts applied</s-text>
            <s-heading>{String(stats.totals.discountsApplied)}</s-heading>
          </s-box>
          <s-box padding="base" borderRadius="base" borderWidth="base">
            <s-text>Discount given</s-text>
            <s-heading>{money(stats.totals.discountTotal)}</s-heading>
          </s-box>
          <s-box padding="base" borderRadius="base" borderWidth="base">
            <s-text>Revenue attributed</s-text>
            <s-heading>{money(stats.totals.revenueAttributed)}</s-heading>
          </s-box>
        </s-grid>
      </s-section>

      {hasData ? (
        <s-section heading="By offer">
          <s-table>
            <s-table-header-row>
              <s-table-header>Offer</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Views</s-table-header>
              <s-table-header>Applied</s-table-header>
              <s-table-header>Discount</s-table-header>
              <s-table-header>Revenue</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {stats.byOffer.map((row) => (
                <s-table-row key={row.offerId}>
                  <s-table-cell>{row.title}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={row.status === "active" ? "success" : "neutral"}>
                      {row.status}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>{String(row.views)}</s-table-cell>
                  <s-table-cell>{String(row.discountsApplied)}</s-table-cell>
                  <s-table-cell>{money(row.discountTotal)}</s-table-cell>
                  <s-table-cell>{money(row.revenueAttributed)}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      ) : (
        <s-section heading="No data yet">
          <s-paragraph>
            Once your widget is live and shoppers start seeing offers, view
            counts appear here. Order-level revenue attribution activates when
            order tracking is enabled for your store.
          </s-paragraph>
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
