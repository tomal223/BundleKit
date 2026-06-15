/**
 * Shared offer form (create + edit). Uses Polaris Web Components.
 *
 * Form strategy: Polaris web components are form-associated custom elements,
 * so values are harvested from FormData on submit (no controlled-input event
 * plumbing, which React 18 doesn't support for custom elements). Dynamic
 * tier rows keep stable keys so uncontrolled values survive add/remove.
 * Custom-element "change" events are attached natively via refs.
 */

import { useEffect, useRef, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useSubmit } from "react-router";

export interface TierRow {
  key: string;
  qty: number;
  type: string;
  value: number;
}

export interface TargetSelection {
  id: string;
  title: string;
}

export interface OfferFormValues {
  title: string;
  message: string;
  type: string;
  targetType: string;
  targets: TargetSelection[];
  tiers: TierRow[];
  startsAt: string; // YYYY-MM-DD or ""
  endsAt: string;
  status: string;
  // BOGO
  buyQty: number;
  getQty: number;
  discountPct: number;
  getProduct: TargetSelection | null;
  // Free gift
  threshold: number;
  giftQty: number;
  giftProduct: TargetSelection | null;
}

export interface OfferFormProps {
  initial: OfferFormValues;
  allowedTypes: string[];
  errorMessage?: string;
}

export const emptyOfferValues: OfferFormValues = {
  title: "",
  message: "",
  type: "quantity_break",
  targetType: "all",
  targets: [],
  tiers: [],
  startsAt: "",
  endsAt: "",
  status: "draft",
  buyQty: 1,
  getQty: 1,
  discountPct: 100,
  getProduct: null,
  threshold: 50,
  giftQty: 1,
  giftProduct: null,
};

const TYPE_OPTIONS = [
  { value: "quantity_break", label: "Quantity break — buy more, save more" },
  { value: "bogo", label: "BOGO — buy X get Y" },
  { value: "free_gift", label: "Free gift — gift above a spend threshold" },
  { value: "bundle", label: "Bundle — discount for buying a set together" },
];

const TIER_TYPE_OPTIONS = [
  { value: "pct", label: "Percent off" },
  { value: "flat", label: "Amount off line" },
  { value: "fixed_price", label: "Fixed price per unit" },
];

let keyCounter = 0;
const nextKey = () => `tier-${Date.now()}-${keyCounter++}`;

export function newTier(qty = 2, type = "pct", value = 10): TierRow {
  return { key: nextKey(), qty, type, value };
}

export function OfferForm({ initial, allowedTypes, errorMessage }: OfferFormProps) {
  const shopify = useAppBridge();
  const submit = useSubmit();
  const formRef = useRef<HTMLFormElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const typeSelectRef = useRef<any>(null);

  const [offerType, setOfferType] = useState(initial.type);
  const [tiers, setTiers] = useState<TierRow[]>(
    initial.tiers.length ? initial.tiers : [newTier(2, "pct", 10)],
  );
  const [targets, setTargets] = useState<TargetSelection[]>(initial.targets);
  const [targetType, setTargetType] = useState(
    initial.type === "bundle" ? "product" : initial.targetType,
  );
  const [getProduct, setGetProduct] = useState(initial.getProduct);
  const [giftProduct, setGiftProduct] = useState(initial.giftProduct);

  // Native listener: React 18 doesn't bind change events on custom elements.
  useEffect(() => {
    const element = typeSelectRef.current as HTMLElement | null;
    if (!element) return;
    const onChange = (event: Event) => {
      const value = (event.target as unknown as { value?: string })?.value;
      if (value) {
        setOfferType(value);
        if (value === "bundle") setTargetType("product");
      }
    };
    element.addEventListener("change", onChange);
    return () => element.removeEventListener("change", onChange);
  }, []);

  const pickSingleProduct = async (assign: (sel: TargetSelection) => void) => {
    const selection = await shopify.resourcePicker({ type: "product", multiple: false });
    const item = (selection as Array<{ id: string; title: string }> | undefined)?.[0];
    if (item) assign({ id: item.id, title: item.title });
  };

  const pickTargets = async (resourceType: string) => {
    const pickerType = resourceType === "collection" ? "collection" : "product";
    const selection = await shopify.resourcePicker({ type: pickerType, multiple: true });
    if (!selection) return;

    if (resourceType === "variant") {
      const variants: TargetSelection[] = [];
      for (const product of selection as Array<{
        title: string;
        variants?: Array<{ id?: string; title?: string }>;
      }>) {
        for (const variant of product.variants ?? []) {
          if (variant.id) {
            variants.push({
              id: variant.id,
              title: `${product.title} — ${variant.title ?? ""}`,
            });
          }
        }
      }
      setTargets(variants);
    } else {
      setTargets(
        (selection as Array<{ id: string; title: string }>).map((item) => ({
          id: item.id,
          title: item.title,
        })),
      );
    }
  };

  const handleSubmit = (status: string) => {
    const form = formRef.current;
    if (!form) return;
    const data = new FormData(form);
    const field = (name: string) => String(data.get(name) ?? "");

    const payload: Record<string, unknown> = {
      title: field("title"),
      message: field("message"),
      type: offerType,
      targetType: offerType === "bundle" ? "product" : targetType,
      targetIds: targets.map((t) => t.id),
      startsAt: field("startsAt"),
      endsAt: field("endsAt"),
      status,
    };

    if (offerType === "quantity_break") {
      payload.tiers = tiers.map((tier) => ({
        qty: Number(data.get(`tier-qty-${tier.key}`) ?? tier.qty),
        type: String(data.get(`tier-type-${tier.key}`) ?? tier.type),
        value: Number(data.get(`tier-value-${tier.key}`) ?? tier.value),
      }));
    } else if (offerType === "bogo") {
      payload.buyQty = Number(field("buyQty"));
      payload.getQty = Number(field("getQty"));
      payload.discountPct = Number(field("discountPct") || 100);
      payload.getProductGid = getProduct?.id ?? "";
    } else if (offerType === "free_gift") {
      payload.threshold = Number(field("threshold"));
      payload.giftQty = Number(field("giftQty") || 1);
      payload.discountPct = Number(field("discountPct") || 100);
      payload.giftProductGid = giftProduct?.id ?? "";
    } else if (offerType === "bundle") {
      payload.discountPct = Number(field("discountPct"));
    }

    submit(JSON.stringify(payload), {
      method: "post",
      encType: "application/json",
    });
  };

  const showTargeting = offerType !== "free_gift";

  return (
    <form ref={formRef} onSubmit={(event) => event.preventDefault()}>
      {errorMessage ? (
        <s-banner tone="critical" heading="Couldn't save offer">
          {errorMessage}
        </s-banner>
      ) : null}

      <s-section heading="Offer type">
        <s-select ref={typeSelectRef} label="Type" name="type" value={offerType}>
          {TYPE_OPTIONS.filter((option) => allowedTypes.includes(option.value)).map(
            (option) => (
              <s-option key={option.value} value={option.value}>
                {option.label}
              </s-option>
            ),
          )}
        </s-select>
        {allowedTypes.length < TYPE_OPTIONS.length ? (
          <s-paragraph>
            More offer types (BOGO, free gift, bundles) are available on paid
            plans. <s-link href="/app/settings">View plans</s-link>
          </s-paragraph>
        ) : null}
      </s-section>

      <s-section heading="Details">
        <s-text-field
          label="Internal name"
          name="title"
          value={initial.title}
          details="Shown only to you, in this admin"
          required
        />
        <s-text-field
          label="Customer message"
          name="message"
          value={initial.message}
          details="Shown in the storefront widget and at checkout, e.g. “Buy 3 Save 20%”"
        />
      </s-section>

      {showTargeting ? (
        <s-section heading={offerType === "bundle" ? "Bundle products" : "Applies to"}>
          {offerType === "bundle" ? (
            <s-paragraph>
              Pick two or more products. The discount applies when a customer
              buys the complete set.
            </s-paragraph>
          ) : (
            <s-choice-list
              label="Target"
              name="targetTypeChoice"
              values={[targetType]}
              onInput={(event) => {
                const value = (event.target as unknown as { value?: string })?.value;
                if (value) {
                  setTargetType(value);
                  setTargets([]);
                }
              }}
            >
              <s-choice value="all">All products</s-choice>
              <s-choice value="product">Specific products</s-choice>
              <s-choice value="collection">Collections</s-choice>
              <s-choice value="variant">Specific variants</s-choice>
            </s-choice-list>
          )}

          {offerType === "bundle" || targetType !== "all" ? (
            <s-stack direction="block" gap="base">
              <s-button
                onClick={() =>
                  pickTargets(offerType === "bundle" ? "product" : targetType)
                }
              >
                {targets.length ? "Change selection" : "Browse…"}
              </s-button>
              {targets.length ? (
                <s-stack direction="inline" gap="small-200">
                  {targets.map((target) => (
                    <s-chip key={target.id}>{target.title}</s-chip>
                  ))}
                </s-stack>
              ) : (
                <s-paragraph>Nothing selected yet.</s-paragraph>
              )}
            </s-stack>
          ) : null}
        </s-section>
      ) : null}

      {offerType === "quantity_break" ? (
        <s-section heading="Discount tiers">
          {tiers.map((tier) => (
            <s-stack key={tier.key} direction="inline" gap="base" alignItems="end">
              <s-number-field
                label="Min quantity"
                name={`tier-qty-${tier.key}`}
                value={String(tier.qty)}
                min={1}
                step={1}
              />
              <s-select label="Discount type" name={`tier-type-${tier.key}`} value={tier.type}>
                {TIER_TYPE_OPTIONS.map((option) => (
                  <s-option key={option.value} value={option.value}>
                    {option.label}
                  </s-option>
                ))}
              </s-select>
              <s-number-field
                label="Value"
                name={`tier-value-${tier.key}`}
                value={String(tier.value)}
                min={0}
              />
              <s-button
                tone="critical"
                accessibilityLabel={`Remove tier ${tier.qty}+`}
                onClick={() => setTiers((rows) => rows.filter((row) => row.key !== tier.key))}
                disabled={tiers.length <= 1 ? true : undefined}
              >
                Remove
              </s-button>
            </s-stack>
          ))}
          <s-button
            onClick={() =>
              setTiers((rows) => [...rows, newTier((rows[rows.length - 1]?.qty ?? 1) + 1)])
            }
          >
            Add tier
          </s-button>
        </s-section>
      ) : null}

      {offerType === "bogo" ? (
        <s-section heading="BOGO rule">
          <s-stack direction="inline" gap="base">
            <s-number-field
              label="Customer buys (qty)"
              name="buyQty"
              value={String(initial.buyQty)}
              min={1}
              step={1}
            />
            <s-number-field
              label="Customer gets (qty)"
              name="getQty"
              value={String(initial.getQty)}
              min={1}
              step={1}
            />
            <s-number-field
              label="Discount on the “get” items (%)"
              name="discountPct"
              value={String(initial.discountPct)}
              min={1}
              max={100}
            />
          </s-stack>
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Optional: make the “get” item a different product. Leave unset
              for classic same-product BOGO (cheapest units are discounted).
            </s-paragraph>
            <s-button onClick={() => pickSingleProduct(setGetProduct)}>
              {getProduct ? "Change product" : "Choose “get” product…"}
            </s-button>
            {getProduct ? (
              <s-stack direction="inline" gap="small-200">
                <s-chip>{getProduct.title}</s-chip>
                <s-button onClick={() => setGetProduct(null)}>Clear</s-button>
              </s-stack>
            ) : null}
          </s-stack>
        </s-section>
      ) : null}

      {offerType === "free_gift" ? (
        <s-section heading="Free gift rule">
          <s-stack direction="inline" gap="base">
            <s-money-field
              label="Spend threshold"
              name="threshold"
              value={String(initial.threshold)}
            />
            <s-number-field
              label="Gift quantity"
              name="giftQty"
              value={String(initial.giftQty)}
              min={1}
              step={1}
            />
            <s-number-field
              label="Gift discount (%)"
              name="discountPct"
              value={String(initial.discountPct)}
              min={1}
              max={100}
            />
          </s-stack>
          <s-stack direction="block" gap="base">
            <s-button onClick={() => pickSingleProduct(setGiftProduct)}>
              {giftProduct ? "Change gift product" : "Choose gift product…"}
            </s-button>
            {giftProduct ? <s-chip>{giftProduct.title}</s-chip> : null}
            <s-paragraph>
              The gift is discounted when it&apos;s in the cart and the
              threshold is met. The storefront widget invites customers to add
              it.
            </s-paragraph>
          </s-stack>
        </s-section>
      ) : null}

      {offerType === "bundle" ? (
        <s-section heading="Bundle discount">
          <s-number-field
            label="Discount on bundle items (%)"
            name="discountPct"
            value={String(initial.discountPct === 100 ? 15 : initial.discountPct)}
            min={1}
            max={100}
          />
        </s-section>
      ) : null}

      <s-section heading="Schedule (optional)">
        <s-stack direction="inline" gap="base">
          <s-date-field label="Start date" name="startsAt" value={initial.startsAt} />
          <s-date-field label="End date" name="endsAt" value={initial.endsAt} />
        </s-stack>
        <s-paragraph>
          Leave blank to run until you pause it. Expired offers stop
          automatically — at sync and again inside the checkout function.
        </s-paragraph>
      </s-section>

      <s-section>
        <s-button-group>
          <s-button variant="primary" onClick={() => handleSubmit("active")}>
            {initial.status === "active" ? "Save" : "Save and activate"}
          </s-button>
          <s-button
            onClick={() => handleSubmit(initial.status === "active" ? "paused" : "draft")}
          >
            {initial.status === "active" ? "Save and pause" : "Save as draft"}
          </s-button>
        </s-button-group>
      </s-section>
    </form>
  );
}
