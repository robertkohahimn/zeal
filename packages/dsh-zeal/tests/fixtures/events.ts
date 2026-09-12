/**
 * Fixture builders for raw `SessionEvent` payloads, shaped exactly like the
 * `SessionEventMap` transcribed at the top of `../../src/tui/normalize.ts`.
 * This is the ONLY place tests encode a raw harness event shape — every
 * `normalize.test.ts` case goes through these builders instead of hand-rolling
 * ad hoc event objects, so a future payload-shape change has one file to fix.
 *
 * Branded ids (`CallId`, `MessageId`) are plain strings at runtime —
 * `Branded<B> = string & { readonly [BRAND]: B }` (dsh-brand
 * lib/types/index.d.ts) erases to `string` with zero wrapping — so fixtures
 * write them as raw strings rather than importing the owning packages' brand
 * factories at runtime. That import is deliberately avoided: the pinned
 * `@deepseek-ai/dsh-llm@0.0.1-rc.1`'s runtime entry point unconditionally
 * imports `@deepseek-ai/dsh-timeout`, a peer dependency that is not installed
 * anywhere in this workspace (confirmed absent from the pnpm store), so
 * `import { CallId } from '@deepseek-ai/dsh-llm'` throws at module-load time
 * even though the type-only import used throughout this repo never touches
 * that code path. The whole fixture is cast through `unknown` into
 * `SessionEvent` regardless (its exact conditional type cannot be re-derived
 * from a plain object literal), so the branded fields need no factory call to
 * type-check — this is exactly the "cast via `as unknown as SessionEvent`
 * where branded types demand" case the brief calls out.
 * @module @zealagent/dsh-zeal/tests/fixtures/events
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** Monotonic fixture timestamps — the exact value never matters to `normalizeEvent`. */
let nextTime = 1_700_000_000_000

/** Wrap event `data` in the `{ type, seq, time, data }` envelope every `SessionEvent` uses. */
function envelope(type: string, seq: number, data: unknown): SessionEvent {
  return { type, seq, time: nextTime++, data } as unknown as SessionEvent
}

export const fixtures = {
  /** `assistant/chunk` carrying a `text-delta` `StreamChunk` (dsh-llm types.d.ts:257-260). */
  textChunk(text: string, seq: number): SessionEvent {
    return envelope('assistant/chunk', seq, {
      turn: 1,
      step: 1,
      chunk: { type: 'text-delta', index: 0, text },
    })
  },

  /** `assistant/chunk` carrying a `reasoning-delta` `StreamChunk` (dsh-llm types.d.ts:261-264). */
  reasoningChunk(text: string, seq: number): SessionEvent {
    return envelope('assistant/chunk', seq, {
      turn: 1,
      step: 1,
      chunk: { type: 'reasoning-delta', index: 0, text },
    })
  },

  /** `turn/start` (dsh-session types.d.ts:214-216). */
  turnStart(seq: number): SessionEvent {
    return envelope('turn/start', seq, { turn: 1 })
  },

  /**
   * `user/message` — the event `data` IS a `UserMessage` directly (dsh-session
   * types.d.ts:246), not wrapped in a `{ message }` field.
   */
  userMessage(text: string, seq: number): SessionEvent {
    return envelope('user/message', seq, {
      id: 'msg_user',
      role: 'user',
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
    })
  },

  /**
   * `assistant/message` — content mixes 'text' and 'reasoning' blocks
   * (dsh-llm types.d.ts:25-33); both are folded out separately downstream.
   * `usage` (I5 / Ruling R4) mirrors `TokenUsage` (dsh-llm types.d.ts:109-115)
   * — omitted entirely (not even an `undefined` key) when not passed, matching
   * "`usage` is absent when the adapter reported none".
   */
  assistantMessage(
    text: string,
    reasoning: string,
    seq: number,
    usage?: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number; reasoningTokens?: number },
  ): SessionEvent {
    return envelope('assistant/message', seq, {
      turn: 1,
      step: 1,
      message: {
        id: 'msg_assistant',
        role: 'assistant',
        content: [
          { type: 'reasoning', text: reasoning },
          { type: 'text', text },
        ],
        source: { kind: 'model', provider: 'zhipu', model: 'glm-4.7' },
      },
      ...(usage !== undefined ? { usage } : {}),
    })
  },

  /**
   * `tool/call` — the raw field is `arguments` (unparsed JSON string exactly
   * as the model produced it), not `args` (dsh-session types.d.ts:270-276).
   */
  toolCall(callId: string, name: string, args: string, seq: number): SessionEvent {
    return envelope('tool/call', seq, {
      turn: 1,
      step: 1,
      callId,
      name,
      arguments: args,
    })
  },

  /**
   * `tool/result` — `message.content` is the one-element `[ToolResultBlock]`
   * tuple (dsh-llm message.d.ts:140-144); `isError` lives on that block
   * (dsh-llm types.d.ts:55-60), and `normalizeEvent` derives `ok = !isError`.
   */
  toolResult(callId: string, isError: boolean, text: string, seq: number): SessionEvent {
    return envelope('tool/result', seq, {
      turn: 1,
      step: 1,
      message: {
        id: 'msg_tool_result',
        role: 'user',
        content: [
          {
            type: 'tool-result',
            toolCallId: callId,
            content: [{ type: 'text', text }],
            isError,
          },
        ],
        source: { kind: 'tool', callId },
      },
    })
  },

  /** `request/header` — `header.config` carries `provider`/`model` (dsh-session types.d.ts:306-309; dsh-llm call-config.d.ts:16-23). */
  requestHeader(provider: string, model: string, seq: number): SessionEvent {
    return envelope('request/header', seq, {
      header: { config: { provider, model } },
      reason: 'initial',
    })
  },

  /**
   * `turn/end` — `reason.kind` drives `normalizeEvent`'s outcome fold
   * (dsh-session types.d.ts:119-153). `kind: 'error'` additionally carries a
   * structured `LlmFailure` at `reason.error`.
   */
  turnEnd(kind: 'completed' | 'aborted' | 'blocked' | 'max-tokens' | 'interrupted', seq: number): SessionEvent {
    const reason = kind === 'aborted'
      ? { kind: 'aborted' as const, reason: { kind: 'user' as const } }
      : { kind }
    return envelope('turn/end', seq, { turn: 1, reason })
  },

  /** `turn/end` with `reason.kind === 'error'`, carrying a structured `LlmFailure`. */
  turnEndError(code: string, message: string, seq: number): SessionEvent {
    return envelope('turn/end', seq, {
      turn: 1,
      reason: { kind: 'error', error: { code, message } },
    })
  },

  /** An event type outside the transcribed vocabulary — must fall through to `other`. */
  unknown(seq: number): SessionEvent {
    return envelope('some/future-event', seq, {})
  },

  /**
   * `compaction/end` (I6b) — see `normalize.ts`'s local `SessionEventMap`
   * augmentation note for why this key isn't part of the pinned
   * `@deepseek-ai/dsh-session@0.0.1-rc.1`'s own declared vocabulary.
   * `normalizeEvent` reads none of the payload's fields, so this fixture's
   * payload is an arbitrary placeholder object.
   */
  compactionEnd(seq: number): SessionEvent {
    return envelope('compaction/end', seq, { turn: 1 })
  },
}
