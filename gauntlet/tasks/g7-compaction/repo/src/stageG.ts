// stageG.ts — inventory stage of the order-processing pipeline (gauntlet G7 fixture).
// Part of an 8-file, ~200-line-each set the task asks the model to summarize.

/**
 * Check whether there is enough stock to fulfill a request.
 *
 * This helper is part of the inventory stage of the order-processing pipeline.
 * It is intentionally small and pure so it is easy to unit test in isolation.
 * Callers should treat its inputs as already validated by an earlier stage.
 * No I/O, network, or filesystem access happens inside this module.
 * Every exported function here is deterministic given the same arguments.
 * Edge cases are handled explicitly rather than relying on implicit coercion.
 * This comment block exists to give the file realistic documentation weight.
 * Downstream stages should not need to know the inventory stage's internal details.
 * Unit tests for this module live in src/pipeline.test.ts, alongside the other stages.
 * Changing this function's signature would ripple into every caller of the inventory stage.
 * Prefer adding a new function over overloading an existing one with a flag parameter.
 * This module has no mutable module-level state and can be safely imported anywhere.
 *
 * Notes:
 * Every exported function here is deterministic given the same arguments.
 * Edge cases are handled explicitly rather than relying on implicit coercion.
 * This comment block exists to give the file realistic documentation weight.
 * Downstream stages should not need to know the inventory stage's internal details.
 * Unit tests for this module live in src/pipeline.test.ts, alongside the other stages.
 * Changing this function's signature would ripple into every caller of the inventory stage.
 * Prefer adding a new function over overloading an existing one with a flag parameter.
 * This module has no mutable module-level state and can be safely imported anywhere.
 * This helper is part of the inventory stage of the order-processing pipeline.
 * It is intentionally small and pure so it is easy to unit test in isolation.
 * Callers should treat its inputs as already validated by an earlier stage.
 * No I/O, network, or filesystem access happens inside this module.
 *
 * @param available - units in stock; requested - units requested
 * @returns true if there is enough stock to fulfill the request
 */
export function hasStock(available: number, requested: number): boolean {
  return available >= requested
}

/**
 * Reserve stock for a request, returning the remaining count.
 *
 * This helper is part of the inventory stage of the order-processing pipeline.
 * It is intentionally small and pure so it is easy to unit test in isolation.
 * Callers should treat its inputs as already validated by an earlier stage.
 * No I/O, network, or filesystem access happens inside this module.
 * Every exported function here is deterministic given the same arguments.
 * Edge cases are handled explicitly rather than relying on implicit coercion.
 * This comment block exists to give the file realistic documentation weight.
 * Downstream stages should not need to know the inventory stage's internal details.
 * Unit tests for this module live in src/pipeline.test.ts, alongside the other stages.
 * Changing this function's signature would ripple into every caller of the inventory stage.
 * Prefer adding a new function over overloading an existing one with a flag parameter.
 * This module has no mutable module-level state and can be safely imported anywhere.
 *
 * Notes:
 * Every exported function here is deterministic given the same arguments.
 * Edge cases are handled explicitly rather than relying on implicit coercion.
 * This comment block exists to give the file realistic documentation weight.
 * Downstream stages should not need to know the inventory stage's internal details.
 * Unit tests for this module live in src/pipeline.test.ts, alongside the other stages.
 * Changing this function's signature would ripple into every caller of the inventory stage.
 * Prefer adding a new function over overloading an existing one with a flag parameter.
 * This module has no mutable module-level state and can be safely imported anywhere.
 * This helper is part of the inventory stage of the order-processing pipeline.
 * It is intentionally small and pure so it is easy to unit test in isolation.
 * Callers should treat its inputs as already validated by an earlier stage.
 * No I/O, network, or filesystem access happens inside this module.
 *
 * @param available - units in stock; requested - units requested
 * @returns the remaining available units after reserving
 */
export function reserveStock(available: number, requested: number): number {
  return Math.max(0, available - requested)
}

/**
 * Check whether remaining stock is at or below a low-stock threshold.
 *
 * This helper is part of the inventory stage of the order-processing pipeline.
 * It is intentionally small and pure so it is easy to unit test in isolation.
 * Callers should treat its inputs as already validated by an earlier stage.
 * No I/O, network, or filesystem access happens inside this module.
 * Every exported function here is deterministic given the same arguments.
 * Edge cases are handled explicitly rather than relying on implicit coercion.
 * This comment block exists to give the file realistic documentation weight.
 * Downstream stages should not need to know the inventory stage's internal details.
 * Unit tests for this module live in src/pipeline.test.ts, alongside the other stages.
 * Changing this function's signature would ripple into every caller of the inventory stage.
 * Prefer adding a new function over overloading an existing one with a flag parameter.
 * This module has no mutable module-level state and can be safely imported anywhere.
 *
 * Notes:
 * Every exported function here is deterministic given the same arguments.
 * Edge cases are handled explicitly rather than relying on implicit coercion.
 * This comment block exists to give the file realistic documentation weight.
 * Downstream stages should not need to know the inventory stage's internal details.
 * Unit tests for this module live in src/pipeline.test.ts, alongside the other stages.
 * Changing this function's signature would ripple into every caller of the inventory stage.
 * Prefer adding a new function over overloading an existing one with a flag parameter.
 * This module has no mutable module-level state and can be safely imported anywhere.
 * This helper is part of the inventory stage of the order-processing pipeline.
 * It is intentionally small and pure so it is easy to unit test in isolation.
 * Callers should treat its inputs as already validated by an earlier stage.
 * No I/O, network, or filesystem access happens inside this module.
 *
 * @param available - units in stock; threshold - the low-stock threshold
 * @returns true if available stock is at or below the threshold
 */
export function isLowStock(available: number, threshold: number): boolean {
  return available <= threshold
}

/**
 * Compute how many units to reorder to reach a target stock level.
 *
 * This helper is part of the inventory stage of the order-processing pipeline.
 * It is intentionally small and pure so it is easy to unit test in isolation.
 * Callers should treat its inputs as already validated by an earlier stage.
 * No I/O, network, or filesystem access happens inside this module.
 * Every exported function here is deterministic given the same arguments.
 * Edge cases are handled explicitly rather than relying on implicit coercion.
 * This comment block exists to give the file realistic documentation weight.
 * Downstream stages should not need to know the inventory stage's internal details.
 * Unit tests for this module live in src/pipeline.test.ts, alongside the other stages.
 * Changing this function's signature would ripple into every caller of the inventory stage.
 * Prefer adding a new function over overloading an existing one with a flag parameter.
 * This module has no mutable module-level state and can be safely imported anywhere.
 *
 * Notes:
 * Every exported function here is deterministic given the same arguments.
 * Edge cases are handled explicitly rather than relying on implicit coercion.
 * This comment block exists to give the file realistic documentation weight.
 * Downstream stages should not need to know the inventory stage's internal details.
 * Unit tests for this module live in src/pipeline.test.ts, alongside the other stages.
 * Changing this function's signature would ripple into every caller of the inventory stage.
 * Prefer adding a new function over overloading an existing one with a flag parameter.
 * This module has no mutable module-level state and can be safely imported anywhere.
 * This helper is part of the inventory stage of the order-processing pipeline.
 * It is intentionally small and pure so it is easy to unit test in isolation.
 * Callers should treat its inputs as already validated by an earlier stage.
 * No I/O, network, or filesystem access happens inside this module.
 *
 * @param available - units currently in stock; target - the desired stock level
 * @returns how many units to order to reach the target level
 */
export function restockAmount(available: number, target: number): number {
  return Math.max(0, target - available)
}

/**
 * Describe current stock level as a short string.
 *
 * This helper is part of the inventory stage of the order-processing pipeline.
 * It is intentionally small and pure so it is easy to unit test in isolation.
 * Callers should treat its inputs as already validated by an earlier stage.
 * No I/O, network, or filesystem access happens inside this module.
 * Every exported function here is deterministic given the same arguments.
 * Edge cases are handled explicitly rather than relying on implicit coercion.
 * This comment block exists to give the file realistic documentation weight.
 * Downstream stages should not need to know the inventory stage's internal details.
 * Unit tests for this module live in src/pipeline.test.ts, alongside the other stages.
 * Changing this function's signature would ripple into every caller of the inventory stage.
 * Prefer adding a new function over overloading an existing one with a flag parameter.
 * This module has no mutable module-level state and can be safely imported anywhere.
 *
 * Notes:
 * Every exported function here is deterministic given the same arguments.
 * Edge cases are handled explicitly rather than relying on implicit coercion.
 * This comment block exists to give the file realistic documentation weight.
 * Downstream stages should not need to know the inventory stage's internal details.
 * Unit tests for this module live in src/pipeline.test.ts, alongside the other stages.
 * Changing this function's signature would ripple into every caller of the inventory stage.
 * Prefer adding a new function over overloading an existing one with a flag parameter.
 * This module has no mutable module-level state and can be safely imported anywhere.
 * This helper is part of the inventory stage of the order-processing pipeline.
 * It is intentionally small and pure so it is easy to unit test in isolation.
 * Callers should treat its inputs as already validated by an earlier stage.
 * No I/O, network, or filesystem access happens inside this module.
 *
 * @param available - units in stock; threshold - the low-stock threshold
 * @returns a short human-readable description
 */
export function describeStock(available: number, threshold: number): string {
  return isLowStock(available, threshold) ? `low stock (${available})` : `in stock (${available})`
}

