/**
 * Registers Zeal's two fail-closed interactive answerers on a live `Context`:
 * the global `'approval/request'` waterfall listener (`ctx.approval`, from
 * `@deepseek-ai/dsh-user-approval`) and the `ctx.userQuestions` provider
 * (`@deepseek-ai/dsh-user-questions`). Without these two registrations no
 * approval-gated tool call and no `ask_user_question` call can ever
 * resolve — both seams fail closed (`'unavailable'`/`NO_PROVIDER`) with
 * nothing composed. `mapQuestions`/`mapAnswers` are exported separately as
 * pure functions for direct unit testing.
 *
 * TRANSCRIBED VOCABULARY. Per this task's authority note, the shapes below
 * are copied from the INSTALLED package `.d.ts` files at the versions
 * pinned in `packages/dsh-zeal/package.json`
 * (`@deepseek-ai/dsh-user-approval@0.0.1-rc.1`,
 * `@deepseek-ai/dsh-user-questions@0.0.1-rc.3`) — cross-checked against the
 * generated `docs/subsystems/approval.md#cordis-surface` region in the
 * `$DSH_SRC` clone, which matches byte-for-byte on the type shapes.
 *
 * `'approval/request'` — dsh-user-approval lib/types/index.d.ts:24, `@mode
 * waterfall`: `(this: Scoped<ApprovalService>, req: ApprovalRequest, next:
 * () => Promise<ApprovalOutcome>) => Promise<ApprovalOutcome>`. Registered
 * below with a plain `ctx.on('approval/request', (req) => ...)` — real
 * precedent for exactly this registration call is the ACP automation
 * bridge, `packages/acp/acp/src/index.ts:215` in the harness source
 * (`ctx.on('approval/request', (request, next) => {...})`). The package
 * README: "compose one terminal answerer per deployment because sibling
 * listener order is not a policy priority mechanism" — Zeal IS that one
 * terminal answerer, so this listener always produces an outcome itself
 * and never calls `next`.
 *
 * `ApprovalRequest` — index.d.ts:104-125: `{ agent: Agent; toolName:
 * string; callId?: CallId; reason?: string; signal?: AbortSignal }`.
 * `Agent` (dsh-agent lib/types/runtime-types.d.ts:60-62) exposes no
 * display-name field, only `readonly id: SessionId` (a branded string, so
 * a plain runtime string) — `agentLabel` below is `String(req.agent.id)`.
 *
 * `ApprovalOutcome` — types.d.ts:23: `'allowed-once' | 'rejected' |
 * 'cancelled' | 'unavailable'`. This listener only ever returns the first
 * three: `store.askApproval`'s `ApprovalDecision` (`model.ts`) is
 * `'allow-once' | 'reject'`, mapped 1:1 onto `'allowed-once'`/`'rejected'`;
 * a store-side abort (the promise REJECTS — see `store.ts`'s
 * `enqueueInteraction`/`removeInteraction`) is caught and mapped to
 * `'cancelled'` — but ONLY when `req.signal?.aborted` is actually `true` at
 * catch time. That catch is required, not defensive dressing:
 * `ApprovalService.request`'s waterfall dispatch (lib/index.js:189) funnels
 * ANY rejection from the waterfall — ours included — through
 * `.then(_, () => 'unavailable')`, so an uncaught rejection here would
 * surface as the wrong outcome (fail-closed, but the WRONG fail-closed
 * value) instead of the brief's required `'cancelled'`. The `aborted` gate
 * matters symmetrically: today `store.askApproval`'s promise can ONLY ever
 * reject via this request's own abort (`store.ts` has no other reject
 * path), but that is an implementation detail of `store.ts`, not a
 * contract this module should assume holds forever. A hypothetical future
 * store rejection unrelated to abort (a genuine bug) must NOT be
 * mislabeled `'cancelled'` — "the user cancelled" and "something broke"
 * are different facts an operator needs to tell apart. Gating on
 * `req.signal?.aborted` and rethrowing otherwise preserves fail-closed
 * behavior either way: a genuine non-abort rejection still propagates out
 * of this listener and still ends up fail-closed, just correctly labeled
 * `'unavailable'` by the seam's own catch-all instead of `'cancelled'`.
 *
 * `ctx.userQuestions.registerProvider(provider)` — dsh-user-questions
 * lib/types/index.d.ts:46: `(provider: UserQuestionProvider) => () =>
 * void`; `UserQuestionProvider` (index.d.ts:29-31) is `{ ask(request:
 * AskUserQuestionRequest): Promise<AskUserQuestionAnswer> }`.
 *
 * `AskUserQuestionRequest` — index.d.ts:20-27: `{ questions:
 * AskUserQuestionItem[]; agent?: Agent; signal?: AbortSignal }`.
 * `AskUserQuestionItem` — types.d.ts:32-47: `{ id: string; question:
 * string; detail?: string; header?: string; options?:
 * AskUserQuestionOption[]; multiSelect?: boolean; intent?:
 * AskUserQuestionIntent }`. `AskUserQuestionIntent` — types.d.ts:21-30:
 * `{ kind: 'plan-review'; approve: string }` — `approve` NAMES the
 * approving option's label (not positional: "Named rather than positional
 * so no UI infers the verdict from option order", per the README).
 * `AskUserQuestionAnswer` — types.d.ts:58-61: `{ answers:
 * AskUserQuestionAnswerItem[] }`; `AskUserQuestionAnswerItem`
 * (types.d.ts:49-56): `{ id: string; selected: string[]; custom?: string
 * }`.
 *
 * Binding carried forward from Task 9 (`InteractionPanel.tsx`'s module doc
 * comment): the panel's plan-review `[a]`/`[r]` keys fall back to
 * `options[0]` as the approve pick when no option label literally contains
 * "approve". `mapQuestions` therefore reorders a plan-review item's mapped
 * `options` so whichever option's label equals `intent.approve` lands at
 * index 0 — the label-match path in the panel already gets this right
 * whenever the upstream label happens to contain "approve"; this reorder
 * is what makes the POSITIONAL fallback correct too, for upstream labels
 * (e.g. `dsh-plan-mode`'s real ones) that don't happen to contain that
 * word.
 * @module @zealagent/dsh-zeal/tui/answerers
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type {
  AskUserQuestionAnswer,
  AskUserQuestionIntent,
  AskUserQuestionItem,
  AskUserQuestionOption,
  AskUserQuestionRequest,
} from '@deepseek-ai/dsh-user-questions'
import type { QuestionAnswer, QuestionItem, QuestionOption } from './model.ts'
import type { ZealStore } from './store.ts'

/**
 * Map one upstream option list into `QuestionOption[]`. For a plan-review
 * item (`intent` supplied), the option whose label equals `intent.approve`
 * is moved to index 0, preserving the relative order of the rest — see the
 * module doc for why. Non-plan-review items (`intent` undefined) pass
 * through in upstream order unchanged.
 * @param options - the upstream `AskUserQuestionItem.options` (already
 *   defaulted to `[]` by the caller when absent).
 * @param intent - the item's plan-review intent, or `undefined` for a
 *   generic (non-plan-review) item.
 * @returns the mapped, possibly reordered, options.
 */
function mapOptions(
  options: readonly AskUserQuestionOption[],
  intent: AskUserQuestionIntent | undefined,
): QuestionOption[] {
  const mapped = options.map((option): QuestionOption =>
    option.description !== undefined
      ? { label: option.label, description: option.description }
      : { label: option.label },
  )
  if (intent === undefined) return mapped
  const approveIndex = mapped.findIndex(option => option.label === intent.approve)
  // Already first, or (defensively) not found — either way, nothing to move.
  // `ask()` itself rejects an `approve` naming no option with `BAD_INTENT`
  // before a provider ever sees the request, so "not found" should not
  // happen in practice; this is a no-op fallback rather than a throw.
  if (approveIndex <= 0) return mapped
  const approveOption = mapped[approveIndex]!
  return [approveOption, ...mapped.slice(0, approveIndex), ...mapped.slice(approveIndex + 1)]
}

/**
 * Map one `AskUserQuestionItem` into a `QuestionItem`. The upstream
 * `intent` object itself does not survive onto the mapped shape —
 * `model.ts`'s `QuestionItem` only carries the derived `planReview`
 * boolean, per Task 6/9's design (the InteractionPanel needs no more than
 * that flag to pick its plan-review render).
 * @param item - one upstream question.
 * @returns the mapped `QuestionItem`.
 */
function mapQuestionItem(item: AskUserQuestionItem): QuestionItem {
  const planReview = item.intent?.kind === 'plan-review'
  const mapped: QuestionItem = {
    id: item.id,
    question: item.question,
    options: mapOptions(item.options ?? [], planReview ? item.intent : undefined),
    multiSelect: item.multiSelect ?? false,
    planReview,
  }
  if (item.detail !== undefined) mapped.detail = item.detail
  if (item.header !== undefined) mapped.header = item.header
  return mapped
}

/**
 * Pure: `AskUserQuestionRequest.questions` → `QuestionItem[]` for
 * `store.askQuestions`. Exported for direct unit testing. See the module
 * doc for the plan-review approve-first reorder this performs.
 * @param request - the seam's question batch.
 * @returns the mapped items, in upstream order.
 */
export function mapQuestions(request: AskUserQuestionRequest): QuestionItem[] {
  return request.questions.map(mapQuestionItem)
}

/**
 * Pure: the store's per-item `QuestionAnswer[]` → the seam's
 * `AskUserQuestionAnswer`, echoing each answer back verbatim (`{id,
 * selected, custom?}`). Walks `items` — not `answers` — so the result is
 * always complete and in the request's original item order: an item with
 * no matching answer gets `{id, selected: []}`, the shape the package
 * README documents for "a UI may preserve a skipped item". Exported for
 * direct unit testing.
 * @param items - the mapped items the answers are for (defines order and
 *   completeness of the result).
 * @param answers - the store's per-item answers.
 * @returns the seam-shaped answer batch.
 */
export function mapAnswers(items: QuestionItem[], answers: QuestionAnswer[]): AskUserQuestionAnswer {
  return {
    answers: items.map((item) => {
      const found = answers.find(answer => answer.id === item.id)
      if (found === undefined) return { id: item.id, selected: [] }
      return found.custom !== undefined
        ? { id: found.id, selected: found.selected, custom: found.custom }
        : { id: found.id, selected: found.selected }
    }),
  }
}

/**
 * Register Zeal's global approval answerer and question provider on `ctx`.
 * Call once per bundle context — see the module doc for the exact seam
 * contracts this wires together, and for why the approval listener catches
 * an abort-caused store rejection but rethrows any other one.
 * @param ctx - the bundle's root context (carries the `'approval/request'`
 *   event and `ctx.userQuestions`).
 * @param store - the TUI's transcript store, which owns the actual
 *   prompt/answer queue (`askApproval`/`askQuestions`, Task 6).
 */
export function registerZealAnswerers(ctx: Context, store: ZealStore): void {
  ctx.on('approval/request', (req: ApprovalRequest): Promise<ApprovalOutcome> => {
    return store
      .askApproval(
        {
          title: `Allow ${req.toolName}?`,
          detail: req.reason ?? '',
          agentLabel: String(req.agent.id),
        },
        req.signal,
      )
      .then((decision): ApprovalOutcome => (decision === 'allow-once' ? 'allowed-once' : 'rejected'))
      .catch((reason: unknown): ApprovalOutcome => {
        // Only a rejection this request's OWN abort actually caused maps to
        // 'cancelled' (see module doc). Anything else is an unexpected
        // failure and must propagate unmapped, so the seam's own waterfall
        // catch-all (lib/index.js:189) — not this listener — labels it
        // 'unavailable' rather than the wrong-but-fail-closed 'cancelled'.
        if (req.signal?.aborted) return 'cancelled'
        throw reason
      })
  })

  // `registerProvider` lives on the UserQuestionService's own context, so
  // its returned disposer is NOT automatically tied to this plugin's fiber
  // the way `ctx.on` above is. Register it as an effect explicitly:
  // otherwise a disposed/remounted zeal-tui fiber would leave the stale
  // provider registered and the seam ("only one provider may be active")
  // would reject the replacement.
  const unregister = ctx.userQuestions.registerProvider({
    ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer> {
      const items = mapQuestions(request)
      return store.askQuestions(items, request.signal).then(answers => mapAnswers(items, answers))
    },
  })
  ctx.effect(() => unregister, 'zeal question provider')
}
