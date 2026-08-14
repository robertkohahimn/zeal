// stageA.ts — intake stage of the order-processing pipeline (gauntlet G7 fixture).
// Part of an 8-file, ~200-line-each set the task asks the model to summarize.

/**
 * Normalize a raw order id into a canonical form.
 *
 * This helper is part of the intake stage of the order-processing pipeline.
 * It is intentionally small and pure so it is easy to unit test in isolation.
 * Callers should treat its inputs as already validated by an earlier stage.
 * No I/O, network, or filesystem access happens inside this module.
 * Every exported function here is deterministic given the same arguments.
 * Edge cases are handled explicitly rather than relying on implicit coercion.
 * This comment block exists to give the file realistic documentation weight.
 * Downstream stages should not need to know the intake stage's internal details.
 * Unit tests for this module live in src/pipeline.test.ts, alongside the other stages.
 * Changing this function's signature would ripple into every caller of the intake stage.
 * Prefer adding a new function over overloading an existing one with a flag parameter.
 * This module has no mutable module-level state and can be safely imported anywhere.
 *
 * Notes:
 * Every exported function here is deterministic given the same arguments.
 * Edge cases are handled explicitly rather than relying on implicit coercion.
 * This comment block exists to give the file realistic documentation weight.
 * Downstream stages should not need to know the intake stage's internal details.
 * Unit tests for this module live in src/pipeline.test.ts, alongside the other stages.
 * Changing this function's signature would ripple into every caller of the intake stage.
 * Prefer adding a new function over overloading an existing one with a flag parameter.
 * This module has no mutable module-level state and can be safely imported anywhere.
 * This helper is part of the intake stage of the order-processing pipeline.
 * It is intentionally small and pure so it is easy to unit test in isolation.
 * Callers should treat its inputs as already validated by an earlier stage.
 * No I/O, network, or filesystem access happens inside this module.
 *
 * @param raw - the raw order id as received
 * @returns a trimmed, uppercased order id
 */
export function normalizeOrderId(raw: string): string {
  return raw.trim().toUpperCase()
}

/**
 * Parse a quantity string into a non-negative integer.
 *
 * This helper is part of the intake stage of the order-processing pipeline.
 * It is intentionally small and pure so it is easy to unit test in isolation.
 * Callers should treat its inputs as already validated by an earlier stage.
 * No I/O, network, or filesystem access happens inside this module.
 * Every exported function here is deterministic given the same arguments.
 * Edge cases are handled explicitly rather than relying on implicit coercion.
 * This comment block exists to give the file realistic documentation weight.
 * Downstream stages should not need to know the intake stage's internal details.
 * Unit tests for this module live in src/pipeline.test.ts, alongside the other stages.
 * Changing this function's signature would ripple into every caller of the intake stage.
 * Prefer adding a new function over overloading an existing one with a flag parameter.
 * This module has no mutable module-level state and can be safely imported anywhere.
 *
 * Notes:
 * Every exported function here is deterministic given the same arguments.
 * Edge cases are handled explicitly rather than relying on implicit coercion.
 * This comment block exists to give the file realistic documentation weight.
 * Downstream stages should not need to know the intake stage's internal details.
 * Unit tests for this module live in src/pipeline.test.ts, alongside the other stages.
 * Changing this function's signature would ripple into every caller of the intake stage.
 * Prefer adding a new function over overloading an existing one with a flag parameter.
 * This module has no mutable module-level state and can be safely imported anywhere.
 * This helper is part of the intake stage of the order-processing pipeline.
 * It is intentionally small and pure so it is easy to unit test in isolation.
 * Callers should treat its inputs as already validated by an earlier stage.
 * No I/O, network, or filesystem access happens inside this module.
 *
 * @param raw - the raw quantity string
 * @returns a non-negative integer quantity, or 0 if unparseable
 */
export function parseQuantity(raw: string): number {
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * Check whether a SKU string matches the expected shape.
 *
 * This helper is part of the intake stage of the order-processing pipeline.
 * It is intentionally small and pure so it is easy to unit test in isolation.
 * Callers should treat its inputs as already validated by an earlier stage.
 * No I/O, network, or filesystem access happens inside this module.
 * Every exported function here is deterministic given the same arguments.
 * Edge cases are handled explicitly rather than relying on implicit coercion.
 * This comment block exists to give the file realistic documentation weight.
 * Downstream stages should not need to know the intake stage's internal details.
 * Unit tests for this module live in src/pipeline.test.ts, alongside the other stages.
 * Changing this function's signature would ripple into every caller of the intake stage.
 * Prefer adding a new function over overloading an existing one with a flag parameter.
 * This module has no mutable module-level state and can be safely imported anywhere.
 *
 * Notes:
 * Every exported function here is deterministic given the same arguments.
 * Edge cases are handled explicitly rather than relying on implicit coercion.
 * This comment block exists to give the file realistic documentation weight.
 * Downstream stages should not need to know the intake stage's internal details.
 * Unit tests for this module live in src/pipeline.test.ts, alongside the other stages.
 * Changing this function's signature would ripple into every caller of the intake stage.
 * Prefer adding a new function over overloading an existing one with a flag parameter.
 * This module has no mutable module-level state and can be safely imported anywhere.
 * This helper is part of the intake stage of the order-processing pipeline.
 * It is intentionally small and pure so it is easy to unit test in isolation.
 * Callers should treat its inputs as already validated by an earlier stage.
 * No I/O, network, or filesystem access happens inside this module.
 *
 * @param sku - the candidate SKU
 * @returns true if the SKU matches the expected shape
 */
export function isValidSku(sku: string): boolean {
  return /^[A-Z]{2}-\d{4}$/.test(sku)
}

/**
 * Remove duplicate SKUs from a line-item list.
 *
 * This helper is part of the intake stage of the order-processing pipeline.
 * It is intentionally small and pure so it is easy to unit test in isolation.
 * Callers should treat its inputs as already validated by an earlier stage.
 * No I/O, network, or filesystem access happens inside this module.
 * Every exported function here is deterministic given the same arguments.
 * Edge cases are handled explicitly rather than relying on implicit coercion.
 * This comment block exists to give the file realistic documentation weight.
 * Downstream stages should not need to know the intake stage's internal details.
 * Unit tests for this module live in src/pipeline.test.ts, alongside the other stages.
 * Changing this function's signature would ripple into every caller of the intake stage.
 * Prefer adding a new function over overloading an existing one with a flag parameter.
 * This module has no mutable module-level state and can be safely imported anywhere.
 *
 * Notes:
 * Every exported function here is deterministic given the same arguments.
 * Edge cases are handled explicitly rather than relying on implicit coercion.
 * This comment block exists to give the file realistic documentation weight.
 * Downstream stages should not need to know the intake stage's internal details.
 * Unit tests for this module live in src/pipeline.test.ts, alongside the other stages.
 * Changing this function's signature would ripple into every caller of the intake stage.
 * Prefer adding a new function over overloading an existing one with a flag parameter.
 * This module has no mutable module-level state and can be safely imported anywhere.
 * This helper is part of the intake stage of the order-processing pipeline.
 * It is intentionally small and pure so it is easy to unit test in isolation.
 * Callers should treat its inputs as already validated by an earlier stage.
 * No I/O, network, or filesystem access happens inside this module.
 *
 * @param skus - a list of SKUs, possibly with duplicates
 * @returns the distinct SKUs, preserving first-seen order
 */
export function dedupeLineItems(skus: string[]): string[] {
  return [...new Set(skus)]
}

/**
 * Summarize an intake batch as a short string.
 *
 * This helper is part of the intake stage of the order-processing pipeline.
 * It is intentionally small and pure so it is easy to unit test in isolation.
 * Callers should treat its inputs as already validated by an earlier stage.
 * No I/O, network, or filesystem access happens inside this module.
 * Every exported function here is deterministic given the same arguments.
 * Edge cases are handled explicitly rather than relying on implicit coercion.
 * This comment block exists to give the file realistic documentation weight.
 * Downstream stages should not need to know the intake stage's internal details.
 * Unit tests for this module live in src/pipeline.test.ts, alongside the other stages.
 * Changing this function's signature would ripple into every caller of the intake stage.
 * Prefer adding a new function over overloading an existing one with a flag parameter.
 * This module has no mutable module-level state and can be safely imported anywhere.
 *
 * Notes:
 * Every exported function here is deterministic given the same arguments.
 * Edge cases are handled explicitly rather than relying on implicit coercion.
 * This comment block exists to give the file realistic documentation weight.
 * Downstream stages should not need to know the intake stage's internal details.
 * Unit tests for this module live in src/pipeline.test.ts, alongside the other stages.
 * Changing this function's signature would ripple into every caller of the intake stage.
 * Prefer adding a new function over overloading an existing one with a flag parameter.
 * This module has no mutable module-level state and can be safely imported anywhere.
 * This helper is part of the intake stage of the order-processing pipeline.
 * It is intentionally small and pure so it is easy to unit test in isolation.
 * Callers should treat its inputs as already validated by an earlier stage.
 * No I/O, network, or filesystem access happens inside this module.
 *
 * @param skus - the line-item SKUs for one order
 * @returns a short human-readable summary string
 */
export function summarizeIntake(skus: string[]): string {
  return `${skus.length} line item(s)`
}

