import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { redirect, useActionData, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { ensureShop } from "../models/shop.server";
import { createOffer, OfferValidationError } from "../services/offer.service";
import { ensureAutomaticDiscount } from "../services/discount.service";
import { offerTypesForPlan } from "../lib/plans.server";
import { parseOfferForm } from "../lib/offer-form.server";
import { OfferForm, newTier, emptyOfferValues } from "../components/OfferForm";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  return { allowedTypes: offerTypesForPlan(shop.plan) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);

  try {
    const input = parseOfferForm(await request.json(), shop.plan);
    if (input.status === "active") {
      await ensureAutomaticDiscount(admin, shop.id);
    }
    await createOffer(admin, shop.id, input);
    return redirect("/app");
  } catch (error) {
    if (error instanceof OfferValidationError) {
      return { error: error.message };
    }
    throw error;
  }
};

export default function NewOffer() {
  const { allowedTypes } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <s-page heading="Create offer">
      <s-link slot="breadcrumb-actions" href="/app">
        Offers
      </s-link>
      <OfferForm
        allowedTypes={allowedTypes}
        errorMessage={actionData?.error}
        initial={{
          ...emptyOfferValues,
          tiers: [newTier(2, "pct", 10), newTier(3, "pct", 20)],
        }}
      />
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
