import { buildOperations } from "./offer_logic";

/**
 * Entry point for the cart.lines.discounts.generate.run target.
 * Pure computation over Shopify-injected input — zero network calls.
 *
 * @param {object} input data selected by cart_lines_discounts_generate_run.graphql
 */
export function cartLinesDiscountsGenerateRun(input) {
  return buildOperations(input);
}
