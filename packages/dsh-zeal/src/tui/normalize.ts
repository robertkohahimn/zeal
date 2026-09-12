/**
 * Normalizes raw `SessionEvent` payloads from `@deepseek-ai/dsh-session` into
 * the flat `ZealEvent` union the TUI renders. This is the ONLY module that
 * touches harness event shapes directly — every other Zeal module consumes
 * `ZealEvent` exclusively.
 *
 * TRANSCRIBED VOCABULARY. Per this task's authority note, field names below
 * are copied from the INSTALLED package `.d.ts` files at the versions pinned
 * in `packages/dsh-zeal/package.json` (`@deepseek-ai/dsh-session@0.0.1-rc.1`,
 * `@deepseek-ai/dsh-llm@0.0.1-rc.1`), not the `$DSH_SRC` clone. Paths below
 * are relative to each package's root.
 *
 * `SessionEvent<T>` — lib/types/types.d.ts:404-425 (dsh-session). A proper
 * discriminated union over `type`: `{ type: T, seq: number, time: number,
 * data: SessionEventMap[T] }` (+ `sourceEventSeqs`/`surfaceOp` on
 * surface-eligible types — irrelevant here). `switch (event.type)` narrows
 * `event.data` without casts.
 *
 * `SessionEventMap` — lib/types/types.d.ts:207-338 (dsh-session):
 *   - 'turn/start': `{ turn: number }` (line 214-216).
 *   - 'turn/end': `{ turn: number, reason: TurnEndReason }` (line 225-228).
 *     `TurnEndReasonMap` (line 119-151) discriminates `reason.kind` over:
 *     'completed' | 'aborted' (+ `reason: TurnEndCancelCause`) | 'blocked' |
 *     'error' (+ `error: LlmFailure`) | 'max-tokens' | 'interrupted'.
 *   - 'user/message': `UserMessage` (line 246) — the event `data` IS the
 *     message directly, NOT wrapped in a `{ message }` field. `UserMessage`
 *     (dsh-llm lib/types/message.d.ts:131-133) extends `Message`, whose
 *     `content: ContentBlock[]` (message.d.ts:126).
 *   - 'assistant/chunk': `{ turn, step, chunk: StreamChunk }` (line 248-252).
 *     `StreamChunk` (dsh-llm lib/types/types.d.ts:253-283) is a union keyed by
 *     `type`; the two variants `ZealEvent` covers are `{ type: 'text-delta',
 *     index, text }` (line 257-260) and `{ type: 'reasoning-delta', index,
 *     text }` (line 261-264). The other variants (`block-start`,
 *     `tool-call-delta`, `block-end`, `usage`, `finish`) fall through to
 *     `'other'`.
 *   - 'assistant/message': `{ turn, step, message: AssistantMessage, usage?
 *     }` (line 259-264). `AssistantMessage.content: ContentBlock[]`
 *     (message.d.ts:135-138) mixes `'text'` and `'reasoning'` blocks
 *     (dsh-llm types.d.ts:25-33). `usage?: TokenUsage` (dsh-llm
 *     types.d.ts:109-115): `{ inputTokens: number, outputTokens: number,
 *     cacheReadTokens?: number, cacheWriteTokens?: number, reasoningTokens?:
 *     number }` — "Token accounting for ONE model call" (that type's own doc
 *     comment), disjoint counts ("billed input = sum of the three" —
 *     `inputTokens` + `cacheReadTokens` + `cacheWriteTokens`), absent when
 *     the adapter reported none. This is PER-REQUEST, not a running session
 *     total — see I5/Ruling R4's note on `ZealEvent`'s `totalTokens` below
 *     for how that shapes the contextFill fold in `store.ts`.
 *   - 'tool/call': `{ turn, step, callId: CallId, name: string, arguments:
 *     string }` (line 270-276). NOTE the raw field is `arguments` (the raw
 *     JSON exactly as the model produced it), not `args` — `ZealEvent.args`
 *     is this field renamed on the way out.
 *   - 'tool/result': `{ turn, step, message: ToolResultMessage, error?:
 *     { name, code }, meta? }` (line 288-297). `ToolResultMessage.content:
 *     [ToolResultBlock]` (message.d.ts:140-144) — a one-element tuple.
 *     `ToolResultBlock` (dsh-llm types.d.ts:55-60): `{ type: 'tool-result',
 *     toolCallId: CallId, content: ContentBlock[], isError?: boolean }`.
 *     `isError` lives on THIS block (not the sibling `tool/result.error`,
 *     which is a separate internal-failure identity); `ok = !isError`.
 *   - 'request/header': `{ header: EpochHeader, reason: RequestHeaderReason
 *     }` (line 306-309). `EpochHeader.config: LlmCallConfig` (line 175-184),
 *     which has `provider: string` and `model: string` (dsh-llm
 *     lib/types/call-config.d.ts:16-23).
 *   - everything else ('step/start', 'step/end', 'todo/write',
 *     'request/context', 'session/end-seed', and any future merge-extended
 *     type) → `{ t: 'other', seq }`.
 *
 * `ContentBlock` — dsh-llm lib/types/types.d.ts:65-75, keyed by `type`:
 * 'text' (`{ type, text }`), 'reasoning' (`{ type, text }`), 'image',
 * 'tool-call', 'tool-result'. `textOf` below joins only the 'text' blocks.
 *
 * `CallId` (dsh-llm lib/types/brand.d.ts:25-31) is `Branded<'CallId'>` =
 * `string & { readonly [BRAND]: 'CallId' }` (dsh-brand lib/types/index.d.ts)
 * — a structural subtype of `string`, so it assigns into `ZealEvent`'s plain
 * `string` fields with no cast.
 * @module @zealagent/dsh-zeal/tui/normalize
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'

/**
 * LOCAL AUGMENTATION (I6b, final-review fix wave): `dsh-zeal` does not
 * depend on `@deepseek-ai/dsh-compaction-basic` directly — it is composed in
 * transitively by the base bundle at runtime (`cordis.patch.yml`), so the
 * merge-extensible `SessionEventMap` this file transcribes from (see the
 * module doc above) has no declaration for the `'compaction/end'` key
 * anywhere in this package's own type graph. Event type name transcribed
 * from `gauntlet/tasks/g7-compaction/verify.sh`'s own citation of
 * `$DSH_SRC/packages/compaction/compaction-basic/src/region.ts`: automatic
 * compaction appends `session.append('compaction/start', lifecycle)`, then
 * on success (or failure — a failure path additionally appends an `error`
 * field) `session.append('compaction/end', lifecycle)`. `normalizeEvent`
 * below reads NONE of that payload's fields — every `compaction/end` folds
 * into the same fixed info notice regardless of content — so this
 * augmentation declares the minimal shape actually needed: none.
 */
declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    'compaction/end': Record<string, unknown>
  }
}

/**
 * I5 (Ruling R4): `assistant-message`'s optional `totalTokens` is derived
 * from the raw event's `usage?: TokenUsage` (see the module doc's
 * transcription) as `inputTokens + cacheReadTokens + cacheWriteTokens +
 * outputTokens` — the three disjoint "billed input" counts plus this
 * request's output, i.e. the full size of THIS ONE request (prompt +
 * completion), not a running sum across the session. `TokenUsage` is
 * explicitly per-model-call, and for an ordinary (non-cached-history) chat
 * API a later request's `inputTokens` already includes the entire prior
 * conversation resent as context — so the LATEST `assistant-message`'s
 * `totalTokens` already approximates current context occupancy on its own;
 * summing it across turns would double- (or triple-, or...) count the
 * shared history and overstate `contextFill`. `store.ts`'s fold reflects
 * this: it keeps only the latest value, never a running total. Absent
 * (`undefined`) exactly when the raw event carried no `usage` at all.
 */
export type ZealEvent =
  | { t: 'turn-start'; seq: number }
  | { t: 'text-delta'; seq: number; text: string }
  | { t: 'reasoning-delta'; seq: number; text: string }
  | { t: 'user-message'; seq: number; text: string }
  | { t: 'assistant-message'; seq: number; text: string; reasoning: string; totalTokens?: number }
  | { t: 'tool-call'; seq: number; callId: string; name: string; args: string }
  | { t: 'tool-result'; seq: number; callId: string; ok: boolean; preview: string }
  | { t: 'request-header'; seq: number; provider: string; model: string }
  | { t: 'turn-end'; seq: number; outcome: 'completed' | 'aborted' | 'error'; errorCode?: string; errorMessage?: string }
  /**
   * A store-fold-ready notice normalized directly out of a raw session
   * event — currently only `'compaction/end'` (I6b, final-review fix wave;
   * see the local `SessionEventMap` augmentation above). Distinct from
   * `turn-end`'s own inline error/aborted notices (those stay inline since
   * they piggyback on a turn boundary already being folded); this variant
   * is for a raw event whose ENTIRE normalized meaning is "show this notice".
   */
  | { t: 'notice'; seq: number; level: 'info' | 'error'; text: string }
  | { t: 'other'; seq: number }

/** Tool-result previews are truncated here so a giant command output cannot blow up the TUI's render buffer. */
const PREVIEW_MAX_CHARS = 2000

/**
 * Join the `text` of every `'text'` content block, in order, ignoring every
 * other block type (`'reasoning'`, `'image'`, `'tool-call'`, `'tool-result'`,
 * and any future merge-extended block).
 * @param content - ordered model-facing content blocks.
 * @returns the concatenated visible text.
 */
export function textOf(content: ReadonlyArray<{ type: string; text?: string }>): string {
  let out = ''
  for (const block of content) {
    if (block.type === 'text' && block.text !== undefined) out += block.text
  }
  return out
}

/**
 * Same join as {@link textOf}, but for `'reasoning'` blocks. Not exported:
 * `'assistant/message'` normalization is its only caller, and the brief's
 * public surface names only `textOf`.
 * @param content - ordered model-facing content blocks.
 * @returns the concatenated reasoning text.
 */
function reasoningOf(content: ReadonlyArray<{ type: string; text?: string }>): string {
  let out = ''
  for (const block of content) {
    if (block.type === 'reasoning' && block.text !== undefined) out += block.text
  }
  return out
}

/**
 * Fold a non-error `TurnEndReason.kind` down to the two non-error outcomes
 * `ZealEvent` renders. `'blocked'` (turn rejected before any step ran) and
 * `'interrupted'` (crash-orphaned turn closed on reload) both read as an
 * ungraceful stop, so they fold into `'aborted'`. `'max-tokens'` folds into
 * `'completed'`: the step still produced a usable response, just truncated
 * at the output-token ceiling — no failure occurred.
 * @param kind - every `TurnEndReason.kind` except `'error'` (handled by its own branch, which needs the sibling `error` field).
 * @returns the folded outcome.
 */
function outcomeOf(kind: 'completed' | 'aborted' | 'blocked' | 'max-tokens' | 'interrupted'): 'completed' | 'aborted' {
  switch (kind) {
    case 'completed':
    case 'max-tokens':
      return 'completed'
    case 'aborted':
    case 'blocked':
    case 'interrupted':
      return 'aborted'
  }
}

/**
 * Normalize one raw `SessionEvent` into the flat `ZealEvent` union. The only
 * function downstream Zeal code should call to read a session event — no
 * other module may inspect `event.data` directly.
 * @param event - one entry from the session log.
 * @returns the normalized event.
 */
export function normalizeEvent(event: SessionEvent): ZealEvent {
  const seq = event.seq
  switch (event.type) {
    case 'turn/start':
      return { t: 'turn-start', seq }

    case 'assistant/chunk': {
      const chunk = event.data.chunk
      if (chunk.type === 'text-delta') return { t: 'text-delta', seq, text: chunk.text }
      if (chunk.type === 'reasoning-delta') return { t: 'reasoning-delta', seq, text: chunk.text }
      return { t: 'other', seq }
    }

    case 'user/message':
      return { t: 'user-message', seq, text: textOf(event.data.content) }

    case 'assistant/message': {
      const base = {
        t: 'assistant-message' as const,
        seq,
        text: textOf(event.data.message.content),
        reasoning: reasoningOf(event.data.message.content),
      }
      const usage = event.data.usage
      if (usage === undefined) return base
      // See the `ZealEvent` doc comment above for why this is the sum of
      // THIS request's disjoint token counts, not a running session total.
      const totalTokens = usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0) + usage.outputTokens
      return { ...base, totalTokens }
    }

    case 'tool/call':
      return { t: 'tool-call', seq, callId: event.data.callId, name: event.data.name, args: event.data.arguments }

    case 'tool/result': {
      const [block] = event.data.message.content
      return {
        t: 'tool-result',
        seq,
        callId: block.toolCallId,
        ok: !block.isError,
        preview: textOf(block.content).slice(0, PREVIEW_MAX_CHARS),
      }
    }

    case 'request/header':
      return {
        t: 'request-header',
        seq,
        provider: event.data.header.config.provider,
        model: event.data.header.config.model,
      }

    case 'turn/end': {
      const { reason } = event.data
      if (reason.kind === 'error') {
        return { t: 'turn-end', seq, outcome: 'error', errorCode: reason.error.code, errorMessage: reason.error.message }
      }
      return { t: 'turn-end', seq, outcome: outcomeOf(reason.kind) }
    }

    // I6b (final-review fix wave): a completed (or failed — see the local
    // `SessionEventMap` augmentation note above) compaction cycle is worth
    // telling the user about, so a whole context-shrinking rewrite of the
    // transcript doesn't pass by silently. Kept as a fixed message
    // regardless of payload content, per this task's brief.
    case 'compaction/end':
      return { t: 'notice', seq, level: 'info', text: 'context compacted' }

    default:
      return { t: 'other', seq }
  }
}
