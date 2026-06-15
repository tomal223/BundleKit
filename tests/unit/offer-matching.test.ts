import { describe, it, expect } from "vitest";
import { offerMatchesProduct, validateOfferInput, OfferValidationError } from "../../app/services/offer.service";

const P1 = "gid://shopify/Product/1";
const P2 = "gid://shopify/Product/2";
const V1 = "gid://shopify/ProductVariant/10";

function offer(targetType: string, ids: string[] = []) {
  return { targetType, expandedTargetIds: JSON.stringify(ids) };
}

describe("offerMatchesProduct", () => {
  it("'all' matches any product", () => {
    expect(offerMatchesProduct(offer("all"), P1)).toBe(true);
  });

  it("'product' matches only listed products", () => {
    expect(offerMatchesProduct(offer("product", [P1]), P1)).toBe(true);
    expect(offerMatchesProduct(offer("product", [P1]), P2)).toBe(false);
  });

  it("'collection' matches against expanded product ids", () => {
    expect(offerMatchesProduct(offer("collection", [P1, P2]), P2)).toBe(true);
  });

  it("'variant' requires a matching variant gid", () => {
    expect(offerMatchesProduct(offer("variant", [V1]), P1, V1)).toBe(true);
    expect(offerMatchesProduct(offer("variant", [V1]), P1, null)).toBe(false);
  });
});

describe("validateOfferInput", () => {
  const base = {
    type: "quantity_break" as const,
    title: "Test",
    targetType: "all" as const,
    config: { tiers: [{ qty: 2, type: "pct" as const, value: 10 }] },
  };

  it("accepts a valid quantity break", () => {
    expect(() => validateOfferInput(base)).not.toThrow();
  });

  it("rejects empty tiers", () => {
    expect(() => validateOfferInput({ ...base, config: { tiers: [] } })).toThrow(OfferValidationError);
  });

  it("rejects pct > 100", () => {
    expect(() =>
      validateOfferInput({ ...base, config: { tiers: [{ qty: 2, type: "pct", value: 150 }] } }),
    ).toThrow(OfferValidationError);
  });

  it("rejects duplicate tier quantities", () => {
    expect(() =>
      validateOfferInput({
        ...base,
        config: {
          tiers: [
            { qty: 2, type: "pct", value: 10 },
            { qty: 2, type: "pct", value: 20 },
          ],
        },
      }),
    ).toThrow(OfferValidationError);
  });

  it("rejects targeted offers without targets", () => {
    expect(() => validateOfferInput({ ...base, targetType: "product", targetIds: [] })).toThrow(
      OfferValidationError,
    );
  });

  it("rejects end date before start date", () => {
    expect(() =>
      validateOfferInput({
        ...base,
        startsAt: new Date("2026-07-01"),
        endsAt: new Date("2026-06-01"),
      }),
    ).toThrow(OfferValidationError);
  });
});
