// stageB.ts — validation stage of the order-processing pipeline (gauntlet G7 fixture).
// Part of an 8-file, ~200-line-each set the task asks the model to summarize.

/**
 * Check that an address string is not blank.
 *
 * This helper is part of the validation stage of the order-processing pipeline.
 * It is intentionally small and pure so it is easy to unit test in isolation.
 * Callers should treat its inputs as already validated by an earlier stage.
 * No I/O, network, or filesystem access happens inside this module.
 * Every exported function here is deterministic given the same arguments.
 * Edge cases are handled explicitly rather than relying on implicit coercion.
 * This comment block exists to give the file realistic documentation weight.
 * Downstream stages should not need to know the validation stage's internal details.
 * Unit tests for this module live in src/pipeline.test.ts, alongside the other stages.
 * Changing this function's signature would ripple into every caller of the validation stage.
 * Prefer adding a new function over overloading an existing one with a flag parameter.
 * This module has no mutable module-level state and can be safely imported anywhere.
 *
 * Notes:
 * Every exported function here is deterministic given the same arguments.
 * Edge cases are handled explicitly rather than relying on implicit coercion.
 * This comment block exists to give the file realistic documentation weight.
 * Downstream stages should not need to know the validation stage's internal details.
 * Unit tests for this module live in src/pipeline.test.ts, alongside the other stages.
 * Changing this function's signature would ripple into every caller of the validation stage.
 * Prefer adding a new function over overloading an existing one with a flag parameter.
 * This module has no mutable module-level state and can be safely imported anywhere.
 * This helper is part of the validation stage of the order-processing pipeline.
 * It is intentionally small and pure so it is easy to unit test in isolation.
 * Callers should treat its inputs as already validated by an earlier stage.
 * No I/O, network, or filesystem access happens inside this module.
 *
 * @param address - a shipping address string
 * @returns true if the address has visible content
 */
export function isNonEmptyAddress(address: string): boolean {
  return address.trim().length > 0
}

/**
 * Loosely validate an email address shape.
 *
 * This helper is part of the validation stage of the order-processing pipeline.
 * It is intentionally small and pure so it is easy to unit test in isolation.
 * Callers should treat its inputs as already validated by an earlier stage.
 * No I/O, network, or filesystem access happens inside this module.
 * Every exported function here is deterministic given the same arguments.
 * Edge cases are handled explicitly rather than relying on implicit coercion.
 * This comment block exists to give the file realistic documentation weight.
 * Downstream stages should not need to know the validation stage's internal details.
 * Unit tests for this module live in src/pipeline.test.ts, alongside the other stages.
 * Changing this function's signature would ripple into every caller of the validation stage.
 * Prefer adding a new function over overloading an existing one with a flag parameter.
 * This module has no mutable module-level state and can be safely imported anywhere.
 *
 * Notes:
 * Every exported function here is deterministic given the same arguments.
 * Edge cases are handled explicitly rather than relying on implicit coercion.
 * This comment block exists to give the file realistic documentation weight.
 * Downstream stages should not need to know the validation stage's internal details.
 * Unit tests for this module live in src/pipeline.test.ts, alongside the other stages.
 * Changing this function's signature would ripple into every caller of the validation stage.
 * Prefer adding a new function over overloading an existing one with a flag parameter.
 * This module has no mutable module-level state and can be safely imported anywhere.
 * This helper is part of the validation stage of the order-processing pipeline.
 * It is intentionally small and pure so it is easy to unit test in isolation.
 * Callers should treat its inputs as already validated by an earlier stage.
 * No I/O, network, or filesystem access happens inside this module.
 *
 * @param email - a candidate email address
 * @returns true if it has a plausible local@domain shape
 */
export function isPlausibleEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

/**
 * Clamp a quantity to a maximum allowed value.
 *
 * This helper is part of the validation stage of the order-processing pipeline.
 * It is intentionally small and pure so it is easy to unit test in isolation.
 * Callers should treat its inputs as already validated by an earlier stage.
 * No I/O, network, or filesystem access happens inside this module.
 * Every exported function here is deterministic given the same arguments.
 * Edge cases are handled explicitly rather than relying on implicit coercion.
 * This comment block exists to give the file realistic documentation weight.
 * Downstream stages should not need to know the validation stage's internal details.
 * Unit tests for this module live in src/pipeline.test.ts, alongside the other stages.
 * Changing this function's signature would ripple into every caller of the validation stage.
 * Prefer adding a new function over overloading an existing one with a flag parameter.
 * This module has no mutable module-level state and can be safely imported anywhere.
 *
 * Notes:
 * Every exported function here is deterministic given the same arguments.
 * Edge cases are handled explicitly rather than relying on implicit coercion.
 * This comment block exists to give the file realistic documentation weight.
 * Downstream stages should not need to know the validation stage's internal details.
 * Unit tests for this module live in src/pipeline.test.ts, alongside the other stages.
 * Changing this function's signature would ripple into every caller of the validation stage.
 * Prefer adding a new function over overloading an existing one with a flag parameter.
 * This module has no mutable module-level state and can be safely imported anywhere.
 * This helper is part of the validation stage of the order-processing pipeline.
 * It is intentionally small and pure so it is easy to unit test in isolation.
 * Callers should treat its inputs as already validated by an earlier stage.
 * No I/O, network, or filesystem access happens inside this module.
 *
 * @param qty - the requested quantity; max - the maximum allowed
 * @returns the quantity clamped to [0, max]
 */
export function clampQuantity(qty: number, max: number): number {
  if (qty < 0) return 0
  if (qty > max) return max
  return qty
}

/**
 * Run basic structural validation on an order.
 *
 * This helper is part of the validation stage of the order-processing pipeline.
 * It is intentionally small and pure so it is easy to unit test in isolation.
 * Callers should treat its inputs as already validated by an earlier stage.
 * No I/O, network, or filesystem access happens inside this module.
 * Every exported function here is deterministic given the same arguments.
 * Edge cases are handled explicitly rather than relying on implicit coercion.
 * This comment block exists to give the file realistic documentation weight.
 * Downstream stages should not need to know the validation stage's internal details.
 * Unit tests for this module live in src/pipeline.test.ts, alongside the other stages.
 * Changing this function's signature would ripple into every caller of the validation stage.
 * Prefer adding a new function over overloading an existing one with a flag parameter.
 * This module has no mutable module-level state and can be safely imported anywhere.
 *
 * Notes:
 * Every exported function here is deterministic given the same arguments.
 * Edge cases are handled explicitly rather than relying on implicit coercion.
 * This comment block exists to give the file realistic documentation weight.
 * Downstream stages should not need to know the validation stage's internal details.
 * Unit tests for this module live in src/pipeline.test.ts, alongside the other stages.
 * Changing this function's signature would ripple into every caller of the validation stage.
 * Prefer adding a new function over overloading an existing one with a flag parameter.
 * This module has no mutable module-level state and can be safely imported anywhere.
 * This helper is part of the validation stage of the order-processing pipeline.
 * It is intentionally small and pure so it is easy to unit test in isolation.
 * Callers should treat its inputs as already validated by an earlier stage.
 * No I/O, network, or filesystem access happens inside this module.
 *
 * @param skus - line-item SKUs; address - shipping address
 * @returns true if the order passes basic validation
 */
export function validateOrder(skus: string[], address: string): boolean {
  return skus.length > 0 && address.trim().length > 0
}

/**
 * Describe a validation result as a short string.
 *
 * This helper is part of the validation stage of the order-processing pipeline.
 * It is intentionally small and pure so it is easy to unit test in isolation.
 * Callers should treat its inputs as already validated by an earlier stage.
 * No I/O, network, or filesystem access happens inside this module.
 * Every exported function here is deterministic given the same arguments.
 * Edge cases are handled explicitly rather than relying on implicit coercion.
 * This comment block exists to give the file realistic documentation weight.
 * Downstream stages should not need to know the validation stage's internal details.
 * Unit tests for this module live in src/pipeline.test.ts, alongside the other stages.
 * Changing this function's signature would ripple into every caller of the validation stage.
 * Prefer adding a new function over overloading an existing one with a flag parameter.
 * This module has no mutable module-level state and can be safely imported anywhere.
 *
 * Notes:
 * Every exported function here is deterministic given the same arguments.
 * Edge cases are handled explicitly rather than relying on implicit coercion.
 * This comment block exists to give the file realistic documentation weight.
 * Downstream stages should not need to know the validation stage's internal details.
 * Unit tests for this module live in src/pipeline.test.ts, alongside the other stages.
 * Changing this function's signature would ripple into every caller of the validation stage.
 * Prefer adding a new function over overloading an existing one with a flag parameter.
 * This module has no mutable module-level state and can be safely imported anywhere.
 * This helper is part of the validation stage of the order-processing pipeline.
 * It is intentionally small and pure so it is easy to unit test in isolation.
 * Callers should treat its inputs as already validated by an earlier stage.
 * No I/O, network, or filesystem access happens inside this module.
 *
 * @param ok - the validation result
 * @returns a short human-readable description
 */
export function describeValidation(ok: boolean): string {
  return ok ? 'valid' : 'invalid'
}

