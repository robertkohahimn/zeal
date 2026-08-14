// stageH.ts — notification stage of the order-processing pipeline (gauntlet G7 fixture).
// Part of an 8-file, ~200-line-each set the task asks the model to summarize.

/**
 * Build the subject line for an order-confirmation email.
 *
 * This helper is part of the notification stage of the order-processing pipeline.
 * It is intentionally small and pure so it is easy to unit test in isolation.
 * Callers should treat its inputs as already validated by an earlier stage.
 * No I/O, network, or filesystem access happens inside this module.
 * Every exported function here is deterministic given the same arguments.
 * Edge cases are handled explicitly rather than relying on implicit coercion.
 * This comment block exists to give the file realistic documentation weight.
 * Downstream stages should not need to know the notification stage's internal details.
 * Unit tests for this module live in src/pipeline.test.ts, alongside the other stages.
 * Changing this function's signature would ripple into every caller of the notification stage.
 * Prefer adding a new function over overloading an existing one with a flag parameter.
 * This module has no mutable module-level state and can be safely imported anywhere.
 *
 * Notes:
 * Every exported function here is deterministic given the same arguments.
 * Edge cases are handled explicitly rather than relying on implicit coercion.
 * This comment block exists to give the file realistic documentation weight.
 * Downstream stages should not need to know the notification stage's internal details.
 * Unit tests for this module live in src/pipeline.test.ts, alongside the other stages.
 * Changing this function's signature would ripple into every caller of the notification stage.
 * Prefer adding a new function over overloading an existing one with a flag parameter.
 * This module has no mutable module-level state and can be safely imported anywhere.
 * This helper is part of the notification stage of the order-processing pipeline.
 * It is intentionally small and pure so it is easy to unit test in isolation.
 * Callers should treat its inputs as already validated by an earlier stage.
 * No I/O, network, or filesystem access happens inside this module.
 *
 * @param orderId - the canonical order id
 * @returns an email subject line for the order confirmation
 */
export function confirmationSubject(orderId: string): string {
  return `Your order ${orderId} is confirmed`
}

/**
 * Build the plain-text body for an order-confirmation email.
 *
 * This helper is part of the notification stage of the order-processing pipeline.
 * It is intentionally small and pure so it is easy to unit test in isolation.
 * Callers should treat its inputs as already validated by an earlier stage.
 * No I/O, network, or filesystem access happens inside this module.
 * Every exported function here is deterministic given the same arguments.
 * Edge cases are handled explicitly rather than relying on implicit coercion.
 * This comment block exists to give the file realistic documentation weight.
 * Downstream stages should not need to know the notification stage's internal details.
 * Unit tests for this module live in src/pipeline.test.ts, alongside the other stages.
 * Changing this function's signature would ripple into every caller of the notification stage.
 * Prefer adding a new function over overloading an existing one with a flag parameter.
 * This module has no mutable module-level state and can be safely imported anywhere.
 *
 * Notes:
 * Every exported function here is deterministic given the same arguments.
 * Edge cases are handled explicitly rather than relying on implicit coercion.
 * This comment block exists to give the file realistic documentation weight.
 * Downstream stages should not need to know the notification stage's internal details.
 * Unit tests for this module live in src/pipeline.test.ts, alongside the other stages.
 * Changing this function's signature would ripple into every caller of the notification stage.
 * Prefer adding a new function over overloading an existing one with a flag parameter.
 * This module has no mutable module-level state and can be safely imported anywhere.
 * This helper is part of the notification stage of the order-processing pipeline.
 * It is intentionally small and pure so it is easy to unit test in isolation.
 * Callers should treat its inputs as already validated by an earlier stage.
 * No I/O, network, or filesystem access happens inside this module.
 *
 * @param orderId - the canonical order id; total - the order total
 * @returns a short plain-text confirmation body
 */
export function confirmationBody(orderId: string, total: number): string {
  return `Order ${orderId} placed. Total: $${total.toFixed(2)}.`
}

/**
 * Build the subject line for a shipping-notice email.
 *
 * This helper is part of the notification stage of the order-processing pipeline.
 * It is intentionally small and pure so it is easy to unit test in isolation.
 * Callers should treat its inputs as already validated by an earlier stage.
 * No I/O, network, or filesystem access happens inside this module.
 * Every exported function here is deterministic given the same arguments.
 * Edge cases are handled explicitly rather than relying on implicit coercion.
 * This comment block exists to give the file realistic documentation weight.
 * Downstream stages should not need to know the notification stage's internal details.
 * Unit tests for this module live in src/pipeline.test.ts, alongside the other stages.
 * Changing this function's signature would ripple into every caller of the notification stage.
 * Prefer adding a new function over overloading an existing one with a flag parameter.
 * This module has no mutable module-level state and can be safely imported anywhere.
 *
 * Notes:
 * Every exported function here is deterministic given the same arguments.
 * Edge cases are handled explicitly rather than relying on implicit coercion.
 * This comment block exists to give the file realistic documentation weight.
 * Downstream stages should not need to know the notification stage's internal details.
 * Unit tests for this module live in src/pipeline.test.ts, alongside the other stages.
 * Changing this function's signature would ripple into every caller of the notification stage.
 * Prefer adding a new function over overloading an existing one with a flag parameter.
 * This module has no mutable module-level state and can be safely imported anywhere.
 * This helper is part of the notification stage of the order-processing pipeline.
 * It is intentionally small and pure so it is easy to unit test in isolation.
 * Callers should treat its inputs as already validated by an earlier stage.
 * No I/O, network, or filesystem access happens inside this module.
 *
 * @param orderId - the canonical order id
 * @returns an email subject line for a shipping notice
 */
export function shippedSubject(orderId: string): string {
  return `Your order ${orderId} has shipped`
}

/**
 * Decide whether a customer should be notified.
 *
 * This helper is part of the notification stage of the order-processing pipeline.
 * It is intentionally small and pure so it is easy to unit test in isolation.
 * Callers should treat its inputs as already validated by an earlier stage.
 * No I/O, network, or filesystem access happens inside this module.
 * Every exported function here is deterministic given the same arguments.
 * Edge cases are handled explicitly rather than relying on implicit coercion.
 * This comment block exists to give the file realistic documentation weight.
 * Downstream stages should not need to know the notification stage's internal details.
 * Unit tests for this module live in src/pipeline.test.ts, alongside the other stages.
 * Changing this function's signature would ripple into every caller of the notification stage.
 * Prefer adding a new function over overloading an existing one with a flag parameter.
 * This module has no mutable module-level state and can be safely imported anywhere.
 *
 * Notes:
 * Every exported function here is deterministic given the same arguments.
 * Edge cases are handled explicitly rather than relying on implicit coercion.
 * This comment block exists to give the file realistic documentation weight.
 * Downstream stages should not need to know the notification stage's internal details.
 * Unit tests for this module live in src/pipeline.test.ts, alongside the other stages.
 * Changing this function's signature would ripple into every caller of the notification stage.
 * Prefer adding a new function over overloading an existing one with a flag parameter.
 * This module has no mutable module-level state and can be safely imported anywhere.
 * This helper is part of the notification stage of the order-processing pipeline.
 * It is intentionally small and pure so it is easy to unit test in isolation.
 * Callers should treat its inputs as already validated by an earlier stage.
 * No I/O, network, or filesystem access happens inside this module.
 *
 * @param hasEmail - whether an email address is on file; optedIn - whether the customer opted into notifications
 * @returns true if a notification should be sent
 */
export function shouldNotify(hasEmail: boolean, optedIn: boolean): boolean {
  return hasEmail && optedIn
}

/**
 * Describe the notification decision as a short string.
 *
 * This helper is part of the notification stage of the order-processing pipeline.
 * It is intentionally small and pure so it is easy to unit test in isolation.
 * Callers should treat its inputs as already validated by an earlier stage.
 * No I/O, network, or filesystem access happens inside this module.
 * Every exported function here is deterministic given the same arguments.
 * Edge cases are handled explicitly rather than relying on implicit coercion.
 * This comment block exists to give the file realistic documentation weight.
 * Downstream stages should not need to know the notification stage's internal details.
 * Unit tests for this module live in src/pipeline.test.ts, alongside the other stages.
 * Changing this function's signature would ripple into every caller of the notification stage.
 * Prefer adding a new function over overloading an existing one with a flag parameter.
 * This module has no mutable module-level state and can be safely imported anywhere.
 *
 * Notes:
 * Every exported function here is deterministic given the same arguments.
 * Edge cases are handled explicitly rather than relying on implicit coercion.
 * This comment block exists to give the file realistic documentation weight.
 * Downstream stages should not need to know the notification stage's internal details.
 * Unit tests for this module live in src/pipeline.test.ts, alongside the other stages.
 * Changing this function's signature would ripple into every caller of the notification stage.
 * Prefer adding a new function over overloading an existing one with a flag parameter.
 * This module has no mutable module-level state and can be safely imported anywhere.
 * This helper is part of the notification stage of the order-processing pipeline.
 * It is intentionally small and pure so it is easy to unit test in isolation.
 * Callers should treat its inputs as already validated by an earlier stage.
 * No I/O, network, or filesystem access happens inside this module.
 *
 * @param hasEmail - whether an email address is on file; optedIn - whether the customer opted into notifications
 * @returns a short human-readable description
 */
export function describeNotification(hasEmail: boolean, optedIn: boolean): string {
  return shouldNotify(hasEmail, optedIn) ? 'will notify' : 'will not notify'
}

