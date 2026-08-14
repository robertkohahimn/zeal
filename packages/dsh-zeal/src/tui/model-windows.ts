/**
 * Static context-window sizes (in tokens) for the GLM models Zeal's two
 * shipped routes (`zai`, `zai-coding-cn`) serve, per Ruling R4 of this task's
 * final-review fix wave (I5). The ONLY consumer is `store.ts`'s
 * `contextFill` fold — turning a request's token usage into the status
 * bar's `ctx NN%` segment (`StatusBar.tsx`). Never used to enforce a limit,
 * and — per spec rule N1 — never to derive a dollar figure; the `zai`
 * catalogs price every model at 0, so a cost figure would be confidently
 * wrong rather than merely absent.
 *
 * A model id absent from this map (a future GLM release, or a hand-declared
 * self-hosted route per README.md's "Self-hosted GLM" section) falls back to
 * {@link DEFAULT_MODEL_WINDOW} rather than throwing or omitting `contextFill`
 * outright — an approximate fill figure is more useful than none, and the
 * fallback is deliberately the smallest of the known windows so it never
 * UNDER-states how full the context is for an unrecognized model.
 * @module @zealagent/dsh-zeal/tui/model-windows
 */

/** Context-window size (tokens) per known GLM model id, as documented by Z.ai/Zhipu for each model. */
export const MODEL_WINDOWS: Record<string, number> = {
  'glm-4.5-air': 131072,
  'glm-4.7': 204800,
  'glm-5-turbo': 200000,
  'glm-5.1': 200000,
  'glm-5.2': 1000000,
  'glm-5v-turbo': 200000,
}

/** Fallback context-window size (tokens) for a model id absent from {@link MODEL_WINDOWS}. */
export const DEFAULT_MODEL_WINDOW = 200_000

/**
 * Resolve `model`'s context-window size, falling back to
 * {@link DEFAULT_MODEL_WINDOW} for an unrecognized id.
 * @param model - the model id currently shown in `StatusModel.model`.
 * @returns the model's context-window size in tokens.
 */
export function contextWindowFor(model: string): number {
  return MODEL_WINDOWS[model] ?? DEFAULT_MODEL_WINDOW
}
