// stageF.ts — shipping stage of the order-processing pipeline (gauntlet G7 fixture).
// Part of an 8-file, ~200-line-each set the task asks the model to summarize.

/**
 * Sum item weights into a total shipment weight.
 *
 * This helper is part of the shipping stage of the order-processing pipeline.
 * It is intentionally small and pure so it is easy to unit test in isolation.
 * Callers should treat its inputs as already validated by an earlier stage.
 * No I/O, network, or filesystem access happens inside this module.
 * Every exported function here is deterministic given the same arguments.
 * Edge cases are handled explicitly rather than relying on implicit coercion.
 * This comment block exists to give the file realistic documentation weight.
 * Downstream stages should not need to know the shipping stage's internal details.
 * Unit tests for this module live in src/pipeline.test.ts, alongside the other stages.
 * Changing this function's signature would ripple into every caller of the shipping stage.
 * Prefer adding a new function over overloading an existing one with a flag parameter.
 * This module has no mutable module-level state and can be safely imported anywhere.
 *
 * Notes:
 * Every exported function here is deterministic given the same arguments.
 * Edge cases are handled explicitly rather than relying on implicit coercion.
 * This comment block exists to give the file realistic documentation weight.
 * Downstream stages should not need to know the shipping stage's internal details.
 * Unit tests for this module live in src/pipeline.test.ts, alongside the other stages.
 * Changing this function's signature would ripple into every caller of the shipping stage.
 * Prefer adding a new function over overloading an existing one with a flag parameter.
 * This module has no mutable module-level state and can be safely imported anywhere.
 * This helper is part of the shipping stage of the order-processing pipeline.
 * It is intentionally small and pure so it is easy to unit test in isolation.
 * Callers should treat its inputs as already validated by an earlier stage.
 * No I/O, network, or filesystem access happens inside this module.
 *
 * @param itemWeights - per-item weights
 * @returns the total shipment weight
 */
export function shippingWeight(itemWeights: number[]): number {
  return itemWeights.reduce((sum, w) => sum + w, 0)
}

/**
 * Compute a tiered shipping cost from total weight.
 *
 * This helper is part of the shipping stage of the order-processing pipeline.
 * It is intentionally small and pure so it is easy to unit test in isolation.
 * Callers should treat its inputs as already validated by an earlier stage.
 * No I/O, network, or filesystem access happens inside this module.
 * Every exported function here is deterministic given the same arguments.
 * Edge cases are handled explicitly rather than relying on implicit coercion.
 * This comment block exists to give the file realistic documentation weight.
 * Downstream stages should not need to know the shipping stage's internal details.
 * Unit tests for this module live in src/pipeline.test.ts, alongside the other stages.
 * Changing this function's signature would ripple into every caller of the shipping stage.
 * Prefer adding a new function over overloading an existing one with a flag parameter.
 * This module has no mutable module-level state and can be safely imported anywhere.
 *
 * Notes:
 * Every exported function here is deterministic given the same arguments.
 * Edge cases are handled explicitly rather than relying on implicit coercion.
 * This comment block exists to give the file realistic documentation weight.
 * Downstream stages should not need to know the shipping stage's internal details.
 * Unit tests for this module live in src/pipeline.test.ts, alongside the other stages.
 * Changing this function's signature would ripple into every caller of the shipping stage.
 * Prefer adding a new function over overloading an existing one with a flag parameter.
 * This module has no mutable module-level state and can be safely imported anywhere.
 * This helper is part of the shipping stage of the order-processing pipeline.
 * It is intentionally small and pure so it is easy to unit test in isolation.
 * Callers should treat its inputs as already validated by an earlier stage.
 * No I/O, network, or filesystem access happens inside this module.
 *
 * @param weight - the total shipment weight
 * @returns a tiered shipping cost
 */
export function shippingCostForWeight(weight: number): number {
  if (weight <= 1) return 4.99
  if (weight <= 5) return 8.99
  return 14.99
}

/**
 * Check whether an order qualifies for free shipping.
 *
 * This helper is part of the shipping stage of the order-processing pipeline.
 * It is intentionally small and pure so it is easy to unit test in isolation.
 * Callers should treat its inputs as already validated by an earlier stage.
 * No I/O, network, or filesystem access happens inside this module.
 * Every exported function here is deterministic given the same arguments.
 * Edge cases are handled explicitly rather than relying on implicit coercion.
 * This comment block exists to give the file realistic documentation weight.
 * Downstream stages should not need to know the shipping stage's internal details.
 * Unit tests for this module live in src/pipeline.test.ts, alongside the other stages.
 * Changing this function's signature would ripple into every caller of the shipping stage.
 * Prefer adding a new function over overloading an existing one with a flag parameter.
 * This module has no mutable module-level state and can be safely imported anywhere.
 *
 * Notes:
 * Every exported function here is deterministic given the same arguments.
 * Edge cases are handled explicitly rather than relying on implicit coercion.
 * This comment block exists to give the file realistic documentation weight.
 * Downstream stages should not need to know the shipping stage's internal details.
 * Unit tests for this module live in src/pipeline.test.ts, alongside the other stages.
 * Changing this function's signature would ripple into every caller of the shipping stage.
 * Prefer adding a new function over overloading an existing one with a flag parameter.
 * This module has no mutable module-level state and can be safely imported anywhere.
 * This helper is part of the shipping stage of the order-processing pipeline.
 * It is intentionally small and pure so it is easy to unit test in isolation.
 * Callers should treat its inputs as already validated by an earlier stage.
 * No I/O, network, or filesystem access happens inside this module.
 *
 * @param subtotal - the order subtotal
 * @returns true if the order subtotal clears the free-shipping threshold
 */
export function qualifiesForFreeShipping(subtotal: number): boolean {
  return subtotal >= 50
}

/**
 * Compute the final shipping cost for an order.
 *
 * This helper is part of the shipping stage of the order-processing pipeline.
 * It is intentionally small and pure so it is easy to unit test in isolation.
 * Callers should treat its inputs as already validated by an earlier stage.
 * No I/O, network, or filesystem access happens inside this module.
 * Every exported function here is deterministic given the same arguments.
 * Edge cases are handled explicitly rather than relying on implicit coercion.
 * This comment block exists to give the file realistic documentation weight.
 * Downstream stages should not need to know the shipping stage's internal details.
 * Unit tests for this module live in src/pipeline.test.ts, alongside the other stages.
 * Changing this function's signature would ripple into every caller of the shipping stage.
 * Prefer adding a new function over overloading an existing one with a flag parameter.
 * This module has no mutable module-level state and can be safely imported anywhere.
 *
 * Notes:
 * Every exported function here is deterministic given the same arguments.
 * Edge cases are handled explicitly rather than relying on implicit coercion.
 * This comment block exists to give the file realistic documentation weight.
 * Downstream stages should not need to know the shipping stage's internal details.
 * Unit tests for this module live in src/pipeline.test.ts, alongside the other stages.
 * Changing this function's signature would ripple into every caller of the shipping stage.
 * Prefer adding a new function over overloading an existing one with a flag parameter.
 * This module has no mutable module-level state and can be safely imported anywhere.
 * This helper is part of the shipping stage of the order-processing pipeline.
 * It is intentionally small and pure so it is easy to unit test in isolation.
 * Callers should treat its inputs as already validated by an earlier stage.
 * No I/O, network, or filesystem access happens inside this module.
 *
 * @param weight - total shipment weight; subtotal - order subtotal
 * @returns the shipping cost, 0 if free-shipping-eligible
 */
export function finalShippingCost(weight: number, subtotal: number): number {
  return qualifiesForFreeShipping(subtotal) ? 0 : shippingCostForWeight(weight)
}

/**
 * Describe the shipping cost for an order as a short string.
 *
 * This helper is part of the shipping stage of the order-processing pipeline.
 * It is intentionally small and pure so it is easy to unit test in isolation.
 * Callers should treat its inputs as already validated by an earlier stage.
 * No I/O, network, or filesystem access happens inside this module.
 * Every exported function here is deterministic given the same arguments.
 * Edge cases are handled explicitly rather than relying on implicit coercion.
 * This comment block exists to give the file realistic documentation weight.
 * Downstream stages should not need to know the shipping stage's internal details.
 * Unit tests for this module live in src/pipeline.test.ts, alongside the other stages.
 * Changing this function's signature would ripple into every caller of the shipping stage.
 * Prefer adding a new function over overloading an existing one with a flag parameter.
 * This module has no mutable module-level state and can be safely imported anywhere.
 *
 * Notes:
 * Every exported function here is deterministic given the same arguments.
 * Edge cases are handled explicitly rather than relying on implicit coercion.
 * This comment block exists to give the file realistic documentation weight.
 * Downstream stages should not need to know the shipping stage's internal details.
 * Unit tests for this module live in src/pipeline.test.ts, alongside the other stages.
 * Changing this function's signature would ripple into every caller of the shipping stage.
 * Prefer adding a new function over overloading an existing one with a flag parameter.
 * This module has no mutable module-level state and can be safely imported anywhere.
 * This helper is part of the shipping stage of the order-processing pipeline.
 * It is intentionally small and pure so it is easy to unit test in isolation.
 * Callers should treat its inputs as already validated by an earlier stage.
 * No I/O, network, or filesystem access happens inside this module.
 *
 * @param weight - total shipment weight; subtotal - order subtotal
 * @returns a short human-readable description
 */
export function describeShipping(weight: number, subtotal: number): string {
  const cost = finalShippingCost(weight, subtotal)
  return cost === 0 ? 'free shipping' : `$${cost.toFixed(2)} shipping`
}

