import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { ensureShop } from "../models/shop.server";
import db from "../db.server";
import { PLAN_DETAILS, PLAN_GROWTH, PLAN_PRO } from "../lib/plans.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);

  // Reconcile plan with Shopify's billing state (source of truth).
  const { appSubscriptions } = await billing.check({
    plans: [PLAN_GROWTH, PLAN_PRO],
    isTest: process.env.NODE_ENV !== "production",
  });
  const activePlan =
    appSubscriptions.find((sub) => sub.status === "ACTIVE")?.name ?? "free";

  if (activePlan !== shop.plan) {
    await db.shop.update({ where: { id: shop.id }, data: { plan: activePlan } });
  }

  return { plan: activePlan, plans: PLAN_DETAILS };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing } = await authenticate.admin(request);
  const formData = await request.formData();
  const plan = String(formData.get("plan"));

  if (plan !== PLAN_GROWTH && plan !== PLAN_PRO) {
    return { error: "Unknown plan" };
  }

  // Redirects the merchant to Shopify's subscription confirmation page.
  await billing.request({
    plan,
    isTest: process.env.NODE_ENV !== "production",
  });
  return null;
};

export default function Settings() {
  const { plan, plans } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";

  return (
    <s-page heading="Plan & settings">
      <s-section heading="Your plan">
        <s-paragraph>
          You&apos;re on the{" "}
          <s-text type="strong">{plan === "free" ? "Free" : plan}</s-text>{" "}
          plan. All billing is handled securely by Shopify — no card details
          ever touch BundleKit.
        </s-paragraph>
      </s-section>

      <s-grid gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap="base">
        {plans.map((detail) => {
          const isCurrent =
            detail.name === plan || (detail.name === "free" && plan === "free");
          return (
            <s-box
              key={detail.name}
              padding="base"
              borderRadius="base"
              borderWidth="base"
            >
              <s-stack direction="block" gap="base">
                <s-heading>{detail.label}</s-heading>
                <s-text type="strong">{detail.price}</s-text>
                <s-unordered-list>
                  {detail.features.map((feature) => (
                    <s-list-item key={feature}>{feature}</s-list-item>
                  ))}
                </s-unordered-list>
                {isCurrent ? (
                  <s-badge tone="success">Current plan</s-badge>
                ) : detail.name !== "free" ? (
                  <fetcher.Form method="post">
                    <input type="hidden" name="plan" value={detail.name} />
                    <s-button
                      type="submit"
                      variant="primary"
                      disabled={busy ? true : undefined}
                    >
                      Upgrade — 14-day free trial
                    </s-button>
                  </fetcher.Form>
                ) : null}
              </s-stack>
            </s-box>
          );
        })}
      </s-grid>

      <s-section heading="Fair pricing promise">
        <s-paragraph>
          BundleKit never caps how many offers you can create. Plans scale with
          the bundled revenue we generate for you — if bundles aren&apos;t
          selling, you don&apos;t pay.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
