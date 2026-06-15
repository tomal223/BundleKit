/**
 * BundleKit offer evaluation — pure functions, zero I/O, zero network.
 *
 * GHOST DISCOUNT GUARANTEE
 * ------------------------
 * The backend only writes ACTIVE, non-expired offers to the shop metafield.
 * This module re-checks status / startsAt / endsAt anyway (belt AND
 * suspenders): a paused or expired offer can never produce a discount even
 * if a stale metafield were somehow served.
 *
 * NO-STACKING GUARANTEE
 * ---------------------
 * Offers are evaluated in priority order (lower number first) and each cart
 * line can be claimed by at most ONE offer.
 */

export const METAFIELD_VERSION = 1;

const SUPPORTED_TYPES = ["quantity_break", "bogo", "free_gift", "bundle"];

/**
 * Parses the raw shop metafield value into a list of valid, runnable offers.
 * Returns [] for null, malformed, or unknown-version payloads (fail closed).
 *
 * @param {string | null | undefined} rawValue
 * @param {number} [nowMs] injected clock for testability
 * @returns {Array<object>}
 */
export function parseOffers(rawValue, nowMs = Date.now()) {
  if (!rawValue) return [];

  let payload;
  try {
    payload = JSON.parse(rawValue);
  } catch {
    return [];
  }

  if (!payload || payload.v !== METAFIELD_VERSION || !Array.isArray(payload.offers)) {
    return [];
  }

  return payload.offers
    .filter((offer) => isRunnable(offer, nowMs))
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
}

/**
 * An offer may run only if active, supported, and inside its schedule window.
 * @param {object} offer
 * @param {number} nowMs
 */
export function isRunnable(offer, nowMs) {
  if (!offer || typeof offer !== "object") return false;
  if (offer.status !== "active") return false;
  if (!SUPPORTED_TYPES.includes(offer.type)) return false;
  if (!offer.config || typeof offer.config !== "object") return false;

  if (offer.startsAt) {
    const t = Date.parse(offer.startsAt);
    if (!Number.isNaN(t) && t > nowMs) return false;
  }
  if (offer.endsAt) {
    const t = Date.parse(offer.endsAt);
    if (!Number.isNaN(t) && t <= nowMs) return false;
  }
  return true;
}

/**
 * Does the offer target this cart line?
 * Collection targeting is expanded to product GIDs at sync time by the
 * backend, so "collection" matches against product ids here as well.
 *
 * @param {object} offer
 * @param {{ productId?: string, variantId?: string }} ids
 */
export function offerApplies(offer, ids) {
  switch (offer.targetType) {
    case "all":
      return true;
    case "variant":
      return !!ids.variantId && asArray(offer.targetIds).includes(ids.variantId);
    case "product":
    case "collection":
      return !!ids.productId && asArray(offer.targetIds).includes(ids.productId);
    default:
      return false;
  }
}

/**
 * Picks the best (highest-qty) tier the line quantity qualifies for.
 * @param {Array<{qty:number}>} tiers
 * @param {number} quantity
 */
export function selectTier(tiers, quantity) {
  if (!Array.isArray(tiers)) return null;
  let best = null;
  for (const tier of tiers) {
    if (
      tier &&
      Number.isFinite(tier.qty) &&
      tier.qty >= 1 &&
      quantity >= tier.qty &&
      (!best || tier.qty > best.qty)
    ) {
      best = tier;
    }
  }
  return best;
}

/**
 * Builds the discount value for a tier.
 * Supported tier types: pct | flat | fixed_price.
 * Returns null when the tier produces no positive discount (fail closed).
 *
 * @param {{type:string, value:number}} tier
 * @param {{ unitAmount:number, quantity:number }} line
 */
export function tierValue(tier, line) {
  const value = Number(tier.value);
  if (!Number.isFinite(value) || value <= 0) return null;

  switch (tier.type) {
    case "pct":
      if (value > 100) return null;
      return { percentage: { value } };
    case "flat":
      return { fixedAmount: { amount: round2(value).toFixed(2) } };
    case "fixed_price": {
      // Customer pays `value` per unit; discount = (unit - value) * qty.
      const total = (line.unitAmount - value) * line.quantity;
      if (!Number.isFinite(total) || total <= 0) return null;
      return { fixedAmount: { amount: round2(total).toFixed(2) } };
    }
    default:
      return null;
  }
}

/** Normalized view of a cart line (ProductVariant lines only). */
function normalizeLines(input) {
  const lines = [];
  for (const line of input?.cart?.lines ?? []) {
    if (line?.merchandise?.__typename !== "ProductVariant") continue;
    lines.push({
      id: line.id,
      quantity: line.quantity,
      unitAmount: Number(line.cost?.amountPerQuantity?.amount ?? 0),
      variantId: line.merchandise.id,
      productId: line.merchandise.product?.id,
    });
  }
  return lines;
}

function offerMessage(offer, fallback) {
  return offer.config.message || offer.title || fallback;
}

function pctValue(pct) {
  const value = Number(pct);
  if (!Number.isFinite(value) || value <= 0 || value > 100) return null;
  return { percentage: { value } };
}

/* ── per-type evaluators ──
 * Each returns an array of candidates and claims the lines it used. */

function evalQuantityBreak(offer, lines, claimed) {
  const candidates = [];
  for (const line of lines) {
    if (claimed.has(line.id)) continue;
    if (!offerApplies(offer, line)) continue;

    const tier = selectTier(offer.config.tiers, line.quantity);
    if (!tier) continue;

    const value = tierValue(tier, line);
    if (!value) continue;

    candidates.push({
      message: offerMessage(offer, "Quantity discount"),
      targets: [{ cartLine: { id: line.id } }],
      value,
    });
    claimed.add(line.id);
  }
  return candidates;
}

function evalBogo(offer, lines, claimed) {
  const config = offer.config;
  const buyQty = Math.max(1, Math.floor(Number(config.buyQty) || 1));
  const getQty = Math.max(1, Math.floor(Number(config.getQty) || 1));
  const value = pctValue(config.discountPct ?? 100);
  if (!value) return [];

  const getProductGid = config.getProductGid || null;
  const buyLines = lines.filter(
    (line) => !claimed.has(line.id) && offerApplies(offer, line),
  );
  if (!buyLines.length) return [];

  let freeUnits;
  let getLines;

  if (getProductGid) {
    // Cross-product BOGO: buy N of targeted → discount M of the get-product.
    const buyUnits = buyLines.reduce((sum, line) => sum + line.quantity, 0);
    const sets = Math.floor(buyUnits / buyQty);
    if (sets < 1) return [];
    freeUnits = sets * getQty;
    getLines = lines.filter(
      (line) => !claimed.has(line.id) && line.productId === getProductGid,
    );
  } else {
    // Same-pool BOGO: every (buyQty + getQty) units include getQty discounted.
    const buyUnits = buyLines.reduce((sum, line) => sum + line.quantity, 0);
    const sets = Math.floor(buyUnits / (buyQty + getQty));
    if (sets < 1) return [];
    freeUnits = sets * getQty;
    // Discount the cheapest units first (customer-favorable and predictable).
    getLines = buyLines.slice().sort((a, b) => a.unitAmount - b.unitAmount);
  }

  const candidates = [];
  let remaining = freeUnits;
  for (const line of getLines) {
    if (remaining <= 0) break;
    const units = Math.min(remaining, line.quantity);
    candidates.push({
      message: offerMessage(offer, "Buy more, get more"),
      targets: [{ cartLine: { id: line.id, quantity: units } }],
      value,
    });
    claimed.add(line.id);
    remaining -= units;
  }
  return candidates;
}

function evalFreeGift(offer, lines, claimed) {
  const config = offer.config;
  const threshold = Number(config.threshold);
  const giftProductGid = config.giftProductGid;
  const giftQty = Math.max(1, Math.floor(Number(config.giftQty) || 1));
  if (!Number.isFinite(threshold) || threshold <= 0 || !giftProductGid) return [];

  // Threshold counts targeted lines (targetType all = whole cart),
  // excluding the gift product itself.
  const subtotal = lines.reduce((sum, line) => {
    if (line.productId === giftProductGid) return sum;
    if (!offerApplies(offer, line)) return sum;
    return sum + line.unitAmount * line.quantity;
  }, 0);
  if (subtotal < threshold) return [];

  const value = pctValue(config.discountPct ?? 100);
  if (!value) return [];

  const candidates = [];
  let remaining = giftQty;
  for (const line of lines) {
    if (remaining <= 0) break;
    if (claimed.has(line.id) || line.productId !== giftProductGid) continue;
    const units = Math.min(remaining, line.quantity);
    candidates.push({
      message: offerMessage(offer, "Free gift"),
      targets: [{ cartLine: { id: line.id, quantity: units } }],
      value,
    });
    claimed.add(line.id);
    remaining -= units;
  }
  return candidates;
}

function evalBundle(offer, lines, claimed) {
  const products = asArray(offer.targetIds);
  if (products.length < 2) return [];
  const value = pctValue(offer.config.discountPct);
  if (!value) return [];

  // Group unclaimed units per bundle product.
  const byProduct = new Map();
  for (const line of lines) {
    if (claimed.has(line.id)) continue;
    if (!products.includes(line.productId)) continue;
    const list = byProduct.get(line.productId) ?? [];
    list.push(line);
    byProduct.set(line.productId, list);
  }

  // Complete bundle requires every product present.
  let sets = Infinity;
  for (const productId of products) {
    const units = (byProduct.get(productId) ?? []).reduce(
      (sum, line) => sum + line.quantity,
      0,
    );
    sets = Math.min(sets, units);
  }
  if (!Number.isFinite(sets) || sets < 1) return [];

  const candidates = [];
  for (const productId of products) {
    let remaining = sets;
    for (const line of byProduct.get(productId) ?? []) {
      if (remaining <= 0) break;
      const units = Math.min(remaining, line.quantity);
      candidates.push({
        message: offerMessage(offer, "Bundle discount"),
        targets: [{ cartLine: { id: line.id, quantity: units } }],
        value,
      });
      claimed.add(line.id);
      remaining -= units;
    }
  }
  return candidates;
}

/**
 * Core evaluation: cart lines × offers → product discount candidates.
 *
 * @param {object} input function input (cart, shop.metafield, discount)
 * @param {number} [nowMs]
 * @returns {{operations: Array<object>}}
 */
export function buildOperations(input, nowMs = Date.now()) {
  const classes = input?.discount?.discountClasses;
  if (Array.isArray(classes) && !classes.includes("PRODUCT")) {
    return { operations: [] };
  }

  const offers = parseOffers(input?.shop?.metafield?.value, nowMs);
  if (!offers.length) return { operations: [] };

  const lines = normalizeLines(input);
  if (!lines.length) return { operations: [] };

  const claimed = new Set();
  const candidates = [];

  for (const offer of offers) {
    switch (offer.type) {
      case "quantity_break":
        candidates.push(...evalQuantityBreak(offer, lines, claimed));
        break;
      case "bogo":
        candidates.push(...evalBogo(offer, lines, claimed));
        break;
      case "free_gift":
        candidates.push(...evalFreeGift(offer, lines, claimed));
        break;
      case "bundle":
        candidates.push(...evalBundle(offer, lines, claimed));
        break;
      default:
        break;
    }
  }

  if (!candidates.length) return { operations: [] };

  return {
    operations: [
      {
        productDiscountsAdd: {
          candidates,
          selectionStrategy: "ALL",
        },
      },
    ],
  };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
