import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { redirect, useActionData, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { ensureShop } from "../models/shop.server";
import {
  getOffer,
  updateOffer,
  OfferValidationError,
  type Tier,
} from "../services/offer.service";
import { ensureAutomaticDiscount } from "../services/discount.service";
import { offerTypesForPlan } from "../lib/plans.server";
import { parseOfferForm } from "../lib/offer-form.server";
import {
  OfferForm,
  newTier,
  emptyOfferValues,
  type TierRow,
} from "../components/OfferForm";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const offer = await getOffer(String(params.id), shop.id);
  if (!offer) {
    throw new Response("Offer not found", { status: 404 });
  }

  const config = JSON.parse(offer.config) as {
    tiers?: Tier[];
    message?: string;
    buyQty?: number;
    getQty?: number;
    discountPct?: number;
    getProductGid?: string;
    threshold?: number;
    giftQty?: number;
    giftProductGid?: string;
  };
  const targetIds = JSON.parse(offer.targetIds) as string[];

  return {
    allowedTypes: offerTypesForPlan(shop.plan),
    offer: {
      id: offer.id,
      title: offer.title,
      message: config.message ?? "",
      type: offer.type,
      status: offer.status,
      targetType: offer.targetType,
      targetIds,
      tiers: config.tiers ?? [],
      buyQty: config.buyQty ?? 1,
      getQty: config.getQty ?? 1,
      discountPct: config.discountPct ?? 100,
      getProductGid: config.getProductGid ?? "",
      threshold: config.threshold ?? 50,
      giftQty: config.giftQty ?? 1,
      giftProductGid: config.giftProductGid ?? "",
      startsAt: offer.startsAt?.toISOString().slice(0, 10) ?? "",
      endsAt: offer.endsAt?.toISOString().slice(0, 10) ?? "",
    },
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);

  try {
    const input = parseOfferForm(await request.json(), shop.plan);
    if (input.status === "active") {
      await ensureAutomaticDiscount(admin, shop.id);
    }
    await updateOffer(admin, String(params.id), shop.id, input);
    return redirect("/app");
  } catch (error) {
    if (error instanceof OfferValidationError) {
      return { error: error.message };
    }
    throw error;
  }
};

export default function EditOffer() {
  const { offer, allowedTypes } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  const tierRows: TierRow[] = offer.tiers.length
    ? offer.tiers.map((tier) => ({ ...newTier(tier.qty, tier.type, tier.value) }))
    : [newTier()];

  return (
    <s-page heading={`Edit: ${offer.title}`}>
      <s-link slot="breadcrumb-actions" href="/app">
        Offers
      </s-link>
      <OfferForm
        allowedTypes={allowedTypes}
        errorMessage={actionData?.error}
        initial={{
          ...emptyOfferValues,
          title: offer.title,
          message: offer.message,
          type: offer.type,
          targetType: offer.targetType,
          // Titles for previously selected targets aren't stored; show ids.
          targets: offer.targetIds.map((id) => ({ id, title: shortGid(id) })),
          tiers: tierRows,
          buyQty: offer.buyQty,
          getQty: offer.getQty,
          discountPct: offer.discountPct,
          getProduct: offer.getProductGid
            ? { id: offer.getProductGid, title: shortGid(offer.getProductGid) }
            : null,
          threshold: offer.threshold,
          giftQty: offer.giftQty,
          giftProduct: offer.giftProductGid
            ? { id: offer.giftProductGid, title: shortGid(offer.giftProductGid) }
            : null,
          startsAt: offer.startsAt,
          endsAt: offer.endsAt,
          status: offer.status,
        }}
      />
    </s-page>
  );
}

function shortGid(gid: string) {
  const parts = gid.split("/");
  return `${parts[parts.length - 2] ?? ""} ${parts[parts.length - 1] ?? gid}`;
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
