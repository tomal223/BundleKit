import { describe, it, expect } from "vitest";
import { cartLinesDiscountsGenerateRun } from "./cart_lines_discounts_generate_run";
import { parseOffers, selectTier, tierValue, buildOperations } from "./offer_logic";

const NOW = Date.parse("2026-06-13T12:00:00Z");

function metafield(offers, v = 1) {
  return JSON.stringify({ v, offers });
}

function line({
  id = "gid://shopify/CartLine/1",
  quantity = 1,
  unit = "20.00",
  variantId = "gid://shopify/ProductVariant/11",
  productId = "gid://shopify/Product/111",
} = {}) {
  return {
    id,
    quantity,
    cost: { amountPerQuantity: { amount: unit } },
    merchandise: { __typename: "ProductVariant", id: variantId, product: { id: productId } },
  };
}

function input({ offers, lines = [line()], discountClasses = ["PRODUCT"] }) {
  return {
    cart: { lines },
    shop: { metafield: offers === null ? null : { value: metafield(offers) } },
    discount: { discountClasses },
  };
}

const activeQB = (overrides = {}) => ({
  id: "offer-1",
  type: "quantity_break",
  status: "active",
  title: "Buy more save more",
  targetType: "all",
  targetIds: [],
  priority: 0,
  startsAt: null,
  endsAt: null,
  config: {
    tiers: [
      { qty: 2, type: "pct", value: 10 },
      { qty: 3, type: "pct", value: 20 },
    ],
  },
  ...overrides,
});

describe("parseOffers — fail closed on bad input", () => {
  it("returns [] for null / missing metafield", () => {
    expect(parseOffers(null)).toEqual([]);
    expect(parseOffers(undefined)).toEqual([]);
  });

  it("returns [] for malformed JSON", () => {
    expect(parseOffers("{not json")).toEqual([]);
  });

  it("returns [] for unknown payload version", () => {
    expect(parseOffers(metafield([activeQB()], 999))).toEqual([]);
  });

  it("filters paused and expired offers", () => {
    const offers = [
      activeQB({ id: "a", status: "paused" }),
      activeQB({ id: "b", endsAt: "2026-06-01T00:00:00Z" }),
      activeQB({ id: "c", startsAt: "2026-07-01T00:00:00Z" }),
      activeQB({ id: "d" }),
    ];
    const parsed = parseOffers(metafield(offers), NOW);
    expect(parsed.map((o) => o.id)).toEqual(["d"]);
  });
});

describe("tier selection", () => {
  const tiers = [
    { qty: 2, type: "pct", value: 10 },
    { qty: 5, type: "pct", value: 25 },
  ];

  it("returns null below the lowest tier", () => {
    expect(selectTier(tiers, 1)).toBeNull();
  });

  it("selects highest qualifying tier", () => {
    expect(selectTier(tiers, 2)?.value).toBe(10);
    expect(selectTier(tiers, 4)?.value).toBe(10);
    expect(selectTier(tiers, 5)?.value).toBe(25);
    expect(selectTier(tiers, 50)?.value).toBe(25);
  });
});

describe("tier values", () => {
  it("pct produces percentage value", () => {
    expect(tierValue({ type: "pct", value: 15 }, { unitAmount: 10, quantity: 2 })).toEqual({
      percentage: { value: 15 },
    });
  });

  it("rejects pct > 100 and non-positive values", () => {
    expect(tierValue({ type: "pct", value: 101 }, { unitAmount: 10, quantity: 1 })).toBeNull();
    expect(tierValue({ type: "pct", value: 0 }, { unitAmount: 10, quantity: 1 })).toBeNull();
    expect(tierValue({ type: "flat", value: -5 }, { unitAmount: 10, quantity: 1 })).toBeNull();
  });

  it("fixed_price computes (unit - price) * qty", () => {
    expect(
      tierValue({ type: "fixed_price", value: 8 }, { unitAmount: 10, quantity: 3 }),
    ).toEqual({ fixedAmount: { amount: "6.00" } });
  });

  it("fixed_price above unit price yields no discount", () => {
    expect(
      tierValue({ type: "fixed_price", value: 12 }, { unitAmount: 10, quantity: 3 }),
    ).toBeNull();
  });
});

describe("buildOperations", () => {
  it("applies the matching tier to a qualifying line", () => {
    const result = buildOperations(input({ offers: [activeQB()], lines: [line({ quantity: 3 })] }), NOW);
    expect(result.operations).toHaveLength(1);
    const { candidates, selectionStrategy } = result.operations[0].productDiscountsAdd;
    expect(selectionStrategy).toBe("ALL");
    expect(candidates).toHaveLength(1);
    expect(candidates[0].value).toEqual({ percentage: { value: 20 } });
    expect(candidates[0].targets[0].cartLine.id).toBe("gid://shopify/CartLine/1");
  });

  it("returns no operations when no offer targets the line's product", () => {
    const offer = activeQB({ targetType: "product", targetIds: ["gid://shopify/Product/999"] });
    const result = buildOperations(input({ offers: [offer] }), NOW);
    expect(result.operations).toEqual([]);
  });

  it("matches product targeting (and collection-expanded targeting)", () => {
    const offer = activeQB({ targetType: "product", targetIds: ["gid://shopify/Product/111"] });
    const result = buildOperations(input({ offers: [offer], lines: [line({ quantity: 2 })] }), NOW);
    expect(result.operations[0].productDiscountsAdd.candidates).toHaveLength(1);
  });

  it("applies only the highest-priority offer per line (no stacking)", () => {
    const offers = [
      activeQB({ id: "low", priority: 10, config: { tiers: [{ qty: 1, type: "pct", value: 5 }] } }),
      activeQB({ id: "high", priority: 1, config: { tiers: [{ qty: 1, type: "pct", value: 30 }] } }),
    ];
    const result = buildOperations(input({ offers }), NOW);
    const candidates = result.operations[0].productDiscountsAdd.candidates;
    expect(candidates).toHaveLength(1);
    expect(candidates[0].value).toEqual({ percentage: { value: 30 } });
  });

  it("skips lines that are not product variants", () => {
    const customLine = { id: "x", quantity: 2, merchandise: { __typename: "CustomProduct" } };
    const result = buildOperations(input({ offers: [activeQB()], lines: [customLine] }), NOW);
    expect(result.operations).toEqual([]);
  });

  it("returns no operations when PRODUCT class is not granted", () => {
    const result = buildOperations(
      input({ offers: [activeQB()], discountClasses: ["ORDER"] }),
      NOW,
    );
    expect(result.operations).toEqual([]);
  });
});

describe("BOGO offers", () => {
  const bogo = (config = {}, overrides = {}) => ({
    ...activeQB({ id: "bogo-1", type: "bogo", title: "BOGO deal", ...overrides }),
    config: { buyQty: 1, getQty: 1, discountPct: 100, ...config },
  });

  it("same-pool buy 1 get 1: qty 2 discounts 1 unit at 100%", () => {
    const result = buildOperations(
      input({ offers: [bogo()], lines: [line({ quantity: 2 })] }),
      NOW,
    );
    const candidates = result.operations[0].productDiscountsAdd.candidates;
    expect(candidates).toHaveLength(1);
    expect(candidates[0].targets[0].cartLine.quantity).toBe(1);
    expect(candidates[0].value).toEqual({ percentage: { value: 100 } });
  });

  it("same-pool buy 1 get 1: qty 1 gets nothing", () => {
    const result = buildOperations(
      input({ offers: [bogo()], lines: [line({ quantity: 1 })] }),
      NOW,
    );
    expect(result.operations).toEqual([]);
  });

  it("same-pool BOGO discounts the cheapest line first", () => {
    const cheap = line({ id: "L1", quantity: 1, unit: "5.00", variantId: "v1", productId: "p1" });
    const pricey = line({ id: "L2", quantity: 1, unit: "50.00", variantId: "v2", productId: "p2" });
    const result = buildOperations(
      input({ offers: [bogo()], lines: [pricey, cheap] }),
      NOW,
    );
    const candidates = result.operations[0].productDiscountsAdd.candidates;
    expect(candidates).toHaveLength(1);
    expect(candidates[0].targets[0].cartLine.id).toBe("L1");
  });

  it("cross-product BOGO discounts the get-product line", () => {
    const buyLine = line({ id: "L1", quantity: 2, productId: "gid://shopify/Product/111" });
    const getLine = line({
      id: "L2",
      quantity: 1,
      variantId: "gid://shopify/ProductVariant/22",
      productId: "gid://shopify/Product/222",
    });
    const offer = bogo(
      { buyQty: 2, getQty: 1, discountPct: 50, getProductGid: "gid://shopify/Product/222" },
      { targetType: "product", targetIds: ["gid://shopify/Product/111"] },
    );
    const result = buildOperations(input({ offers: [offer], lines: [buyLine, getLine] }), NOW);
    const candidates = result.operations[0].productDiscountsAdd.candidates;
    expect(candidates).toHaveLength(1);
    expect(candidates[0].targets[0].cartLine.id).toBe("L2");
    expect(candidates[0].value).toEqual({ percentage: { value: 50 } });
  });

  it("cross-product BOGO without the get-product in cart = nothing", () => {
    const buyLine = line({ quantity: 4 });
    const offer = bogo({ buyQty: 2, getQty: 1, getProductGid: "gid://shopify/Product/999" });
    const result = buildOperations(input({ offers: [offer], lines: [buyLine] }), NOW);
    expect(result.operations).toEqual([]);
  });
});

describe("Free gift offers", () => {
  const gift = (config = {}) => ({
    ...activeQB({ id: "gift-1", type: "free_gift", title: "Free gift" }),
    config: {
      threshold: 50,
      giftProductGid: "gid://shopify/Product/900",
      giftQty: 1,
      discountPct: 100,
      ...config,
    },
  });
  const giftLine = (quantity = 1) =>
    line({
      id: "GIFT",
      quantity,
      unit: "15.00",
      variantId: "gid://shopify/ProductVariant/90",
      productId: "gid://shopify/Product/900",
    });

  it("discounts the gift when threshold is met (gift excluded from subtotal)", () => {
    // 3 × $20 = $60 ≥ $50 threshold
    const result = buildOperations(
      input({ offers: [gift()], lines: [line({ quantity: 3 }), giftLine()] }),
      NOW,
    );
    const candidates = result.operations[0].productDiscountsAdd.candidates;
    expect(candidates).toHaveLength(1);
    expect(candidates[0].targets[0].cartLine.id).toBe("GIFT");
    expect(candidates[0].targets[0].cartLine.quantity).toBe(1);
  });

  it("no discount below threshold", () => {
    // 2 × $20 = $40 < $50
    const result = buildOperations(
      input({ offers: [gift()], lines: [line({ quantity: 2 }), giftLine()] }),
      NOW,
    );
    expect(result.operations).toEqual([]);
  });

  it("gift line price never counts toward its own threshold", () => {
    // Only the gift in cart: subtotal of other lines = 0
    const result = buildOperations(
      input({ offers: [gift()], lines: [giftLine(10)] }),
      NOW,
    );
    expect(result.operations).toEqual([]);
  });

  it("caps the discount at giftQty units", () => {
    const result = buildOperations(
      input({
        offers: [gift({ giftQty: 2 })],
        lines: [line({ quantity: 5 }), giftLine(4)],
      }),
      NOW,
    );
    const candidates = result.operations[0].productDiscountsAdd.candidates;
    expect(candidates[0].targets[0].cartLine.quantity).toBe(2);
  });
});

describe("Bundle offers", () => {
  const P1 = "gid://shopify/Product/1";
  const P2 = "gid://shopify/Product/2";
  const bundle = (overrides = {}) => ({
    ...activeQB({
      id: "bundle-1",
      type: "bundle",
      title: "Set deal",
      targetType: "product",
      targetIds: [P1, P2],
    }),
    config: { discountPct: 20 },
    ...overrides,
  });
  const lineP1 = (quantity = 1) =>
    line({ id: "B1", quantity, variantId: "v1", productId: P1 });
  const lineP2 = (quantity = 1) =>
    line({ id: "B2", quantity, variantId: "v2", productId: P2 });

  it("discounts all bundle items when the full set is in the cart", () => {
    const result = buildOperations(
      input({ offers: [bundle()], lines: [lineP1(), lineP2()] }),
      NOW,
    );
    const candidates = result.operations[0].productDiscountsAdd.candidates;
    expect(candidates).toHaveLength(2);
    expect(candidates.map((c) => c.targets[0].cartLine.id).sort()).toEqual(["B1", "B2"]);
    expect(candidates[0].value).toEqual({ percentage: { value: 20 } });
  });

  it("no discount when the set is incomplete", () => {
    const result = buildOperations(
      input({ offers: [bundle()], lines: [lineP1(3)] }),
      NOW,
    );
    expect(result.operations).toEqual([]);
  });

  it("discounts only complete sets (min quantity across products)", () => {
    const result = buildOperations(
      input({ offers: [bundle()], lines: [lineP1(3), lineP2(1)] }),
      NOW,
    );
    const candidates = result.operations[0].productDiscountsAdd.candidates;
    const byLine = Object.fromEntries(
      candidates.map((c) => [c.targets[0].cartLine.id, c.targets[0].cartLine.quantity]),
    );
    expect(byLine.B1).toBe(1);
    expect(byLine.B2).toBe(1);
  });
});

describe("No stacking across offer types", () => {
  it("a line claimed by a quantity break is not also discounted by BOGO", () => {
    const offers = [
      activeQB({ id: "qb", priority: 0 }),
      {
        ...activeQB({ id: "bogo", type: "bogo", priority: 1 }),
        config: { buyQty: 1, getQty: 1, discountPct: 100 },
      },
    ];
    const result = buildOperations(input({ offers, lines: [line({ quantity: 3 })] }), NOW);
    const candidates = result.operations[0].productDiscountsAdd.candidates;
    expect(candidates).toHaveLength(1); // only the quantity break applied
    expect(candidates[0].value).toEqual({ percentage: { value: 20 } });
  });
});

describe("GHOST DISCOUNT PREVENTION — never delete or skip", () => {
  it("missing metafield (offer paused → backend removed it) = zero discounts", () => {
    const result = cartLinesDiscountsGenerateRun(input({ offers: null, lines: [line({ quantity: 5 })] }));
    expect(result.operations).toEqual([]);
  });

  it("empty offers array = zero discounts", () => {
    const result = cartLinesDiscountsGenerateRun(input({ offers: [], lines: [line({ quantity: 5 })] }));
    expect(result.operations).toEqual([]);
  });

  it("paused offer present in stale metafield = zero discounts (double guard)", () => {
    const result = buildOperations(
      input({ offers: [activeQB({ status: "paused" })], lines: [line({ quantity: 5 })] }),
      NOW,
    );
    expect(result.operations).toEqual([]);
  });

  it("expired offer present in stale metafield = zero discounts (double guard)", () => {
    const result = buildOperations(
      input({ offers: [activeQB({ endsAt: "2026-01-01T00:00:00Z" })], lines: [line({ quantity: 5 })] }),
      NOW,
    );
    expect(result.operations).toEqual([]);
  });
});
