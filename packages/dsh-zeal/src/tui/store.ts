/**
 * The transcript store: folds `ZealEvent`s (via `normalizeEvent`, Task 4)
 * into a `ZealViewState` (`model.ts`) the TUI renders. State updates are
 * immutable swaps (`this.state = {...}`) so `getState()` snapshots are safe
 * to diff/memoize against. Listener notifications are coalesced onto a
 * ~16ms `unref()`d timer so a burst of streamed deltas triggers one render,
 * not one per event.
 *
 * Duplicate/out-of-order replay (e.g. resuming a session log from disk) is
 * handled by `apply`'s `seq <= lastSeq` guard — every `ZealEvent` carries a
 * `seq` from the underlying `SessionEvent`, and the fold is a no-op for
 * anything at or below the highest `seq` already applied.
 *
 * Design note on `seq` reassignment: entries a rule "settles" into
 * `settled` (a matched `tool-result`, an orphaned still-running tool at
 * `turn-end`, leftover live text at `turn-end`) are stamped with the `seq`
 * of the *settling* event, not whatever `seq` they were first created
 * under. Because `apply` only ever folds events in strictly increasing
 * `seq` order (the guard above enforces it), stamping with the settling
 * event's `seq` is what guarantees "settled entries only grow, in seq
 * order" holds for every interleaving — not just the ordering the property
 * tests happen to generate.
 * @module @zealagent/dsh-zeal/tui/store
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ZealEvent } from './normalize.ts'
import { normalizeEvent } from './normalize.ts'
import type {
  ApprovalDecision,
  ApprovalPrompt,
  AssistantEntry,
  NoticeEntry,
  PendingInteraction,
  QuestionAnswer,
  QuestionItem,
  QuestionsPrompt,
  StatusModel,
  ToolEntry,
  TranscriptEntry,
  ZealViewState,
} from './model.ts'

/** Listener notifications are coalesced onto this interval. */
const NOTIFY_COALESCE_MS = 16

/**
 * One queued `askApproval`/`askQuestions` request. `resolve`/`reject` are the
 * executor functions of the promise handed back to the caller; `signal`/
 * `onAbort` are only present when the caller passed an `AbortSignal`, so the
 * listener can be torn down once the request settles by other means.
 */
interface InteractionEntry {
  prompt: PendingInteraction
  resolve: (result: ApprovalDecision | QuestionAnswer[]) => void
  reject: (reason: unknown) => void
  signal?: AbortSignal
  onAbort?: () => void
}

export class ZealStore {
  private state: ZealViewState
  /**
   * Highest applied `seq`, or `-1` before any event has been applied.
   * Session seqs start at 0 (`Session.seq` is the log length), so the guard
   * below must treat `-1` as "nothing applied yet" rather than `0` — an
   * initial `0` would silently drop a genuine seq-0 event (e.g. a resumed
   * session's very first `turn/start`).
   */
  private lastSeq = -1
  private readonly listeners = new Set<() => void>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private readonly interactionQueue: InteractionEntry[] = []
  private nextInteractionId = 1

  constructor(initialStatus: { provider: string; model: string }) {
    this.state = {
      settled: [],
      status: { provider: initialStatus.provider, model: initialStatus.model, running: false },
    }
  }

  /** The current view model. Safe to hold onto — state is never mutated in place. */
  getState(): ZealViewState {
    return this.state
  }

  /** Subscribe to (coalesced) state-change notifications. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Normalize and fold one raw `SessionEvent`. Stale (`seq <= lastSeq`) events are dropped. */
  apply(event: SessionEvent): void {
    const zealEvent = normalizeEvent(event)
    if (zealEvent.seq <= this.lastSeq) return
    this.lastSeq = zealEvent.seq
    this.fold(zealEvent)
    this.scheduleNotify()
  }

  /** Append a store-originated (not session-event-driven) notice, e.g. connection status. */
  addNotice(level: 'info' | 'error', text: string): void {
    // Clamp to 0 before any real event has landed — `lastSeq` starts at -1
    // purely so the seq-0-event guard below works; a notice's display seq
    // should never go negative.
    const seq = Math.max(this.lastSeq, 0)
    this.state = { ...this.state, settled: [...this.state.settled, this.notice(seq, level, text)] }
    this.scheduleNotify()
  }

  /** Merge a partial patch into the status-bar model. */
  setStatus(patch: Partial<StatusModel>): void {
    this.state = { ...this.state, status: { ...this.state.status, ...patch } }
    this.scheduleNotify()
  }

  /**
   * Queue an approval request. Resolves with the `ApprovalDecision` passed to
   * `resolveInteraction`, or rejects with `signal`'s abort reason if it fires
   * (or is already aborted) before that happens.
   */
  askApproval(input: Omit<ApprovalPrompt, 'kind' | 'id'>, signal?: AbortSignal): Promise<ApprovalDecision> {
    const prompt: ApprovalPrompt = { kind: 'approval', id: this.nextInteractionId++, ...input }
    return new Promise<ApprovalDecision>((resolve, reject) => {
      const settle = (result: ApprovalDecision | QuestionAnswer[]): void => resolve(result as ApprovalDecision)
      this.enqueueInteraction(prompt, settle, reject, signal)
    })
  }

  /**
   * Queue a batch of questions. Resolves with the `QuestionAnswer[]` passed
   * to `resolveInteraction`, or rejects with `signal`'s abort reason if it
   * fires (or is already aborted) before that happens.
   */
  askQuestions(items: QuestionItem[], signal?: AbortSignal): Promise<QuestionAnswer[]> {
    const prompt: QuestionsPrompt = { kind: 'questions', id: this.nextInteractionId++, items }
    return new Promise<QuestionAnswer[]>((resolve, reject) => {
      const settle = (result: ApprovalDecision | QuestionAnswer[]): void => resolve(result as QuestionAnswer[])
      this.enqueueInteraction(prompt, settle, reject, signal)
    })
  }

  /**
   * Settle the queued request with the given `id` (normally the head, i.e.
   * `state.interaction`) with `result`, resolving its promise and promoting
   * the next queued request (if any) into `state.interaction`. A no-op if
   * `id` no longer matches anything queued (e.g. it was already settled or
   * aborted).
   */
  resolveInteraction(id: number, result: ApprovalDecision | QuestionAnswer[]): void {
    const idx = this.interactionQueue.findIndex(entry => entry.prompt.id === id)
    if (idx === -1) return
    const entry = this.interactionQueue[idx]!
    this.interactionQueue.splice(idx, 1)
    if (entry.signal && entry.onAbort) entry.signal.removeEventListener('abort', entry.onAbort)
    entry.resolve(result)
    this.syncInteractionState()
    this.scheduleNotify()
  }

  /** Push a request onto the queue (or reject it outright if already aborted), wiring up abort handling. */
  private enqueueInteraction(
    prompt: PendingInteraction,
    resolve: (result: ApprovalDecision | QuestionAnswer[]) => void,
    reject: (reason: unknown) => void,
    signal: AbortSignal | undefined,
  ): void {
    const entry: InteractionEntry = { prompt, resolve, reject }
    if (signal) {
      if (signal.aborted) {
        reject(signal.reason)
        return
      }
      entry.signal = signal
      entry.onAbort = () => this.removeInteraction(entry, signal.reason)
      signal.addEventListener('abort', entry.onAbort, { once: true })
    }
    this.interactionQueue.push(entry)
    this.syncInteractionState()
    this.scheduleNotify()
  }

  /** Remove a still-queued entry (head or not) and reject it, e.g. on late abort. */
  private removeInteraction(entry: InteractionEntry, reason: unknown): void {
    const idx = this.interactionQueue.indexOf(entry)
    if (idx === -1) return
    this.interactionQueue.splice(idx, 1)
    entry.reject(reason)
    this.syncInteractionState()
    this.scheduleNotify()
  }

  /** Sync `state.interaction` to the current queue head (or clear it when the queue is empty). */
  private syncInteractionState(): void {
    const head = this.interactionQueue[0]
    if (head) {
      this.state = { ...this.state, interaction: head.prompt }
    } else {
      const { interaction: _droppedInteraction, ...rest } = this.state
      this.state = rest
    }
  }

  private notice(seq: number, level: 'info' | 'error', text: string): NoticeEntry {
    return { kind: 'notice', seq, level, text }
  }

  private scheduleNotify(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      for (const listener of this.listeners) listener()
    }, NOTIFY_COALESCE_MS)
    this.timer.unref?.()
  }

  private fold(e: ZealEvent): void {
    switch (e.t) {
      case 'turn-start': {
        this.state = {
          ...this.state,
          live: { text: '', reasoning: '', tools: [] },
          status: { ...this.state.status, running: true },
        }
        return
      }

      case 'text-delta': {
        const live = this.state.live
        if (!live) return
        this.state = { ...this.state, live: { ...live, text: live.text + e.text } }
        return
      }

      case 'reasoning-delta': {
        const live = this.state.live
        if (!live) return
        this.state = { ...this.state, live: { ...live, reasoning: live.reasoning + e.text } }
        return
      }

      case 'tool-call': {
        const live = this.state.live
        if (!live) return
        const entry: ToolEntry = {
          kind: 'tool', seq: e.seq, callId: e.callId, name: e.name, args: e.args, status: 'running', preview: '',
        }
        this.state = { ...this.state, live: { ...live, tools: [...live.tools, entry] } }
        return
      }

      case 'tool-result': {
        const live = this.state.live
        if (!live) return
        const idx = live.tools.findIndex(t => t.callId === e.callId)
        if (idx === -1) return
        const settledTool: ToolEntry = {
          ...live.tools[idx]!,
          seq: e.seq,
          status: e.ok ? 'ok' : 'error',
          preview: e.preview,
        }
        const tools = [...live.tools.slice(0, idx), ...live.tools.slice(idx + 1)]
        this.state = {
          ...this.state,
          live: { ...live, tools },
          settled: [...this.state.settled, settledTool],
        }
        return
      }

      case 'user-message': {
        const entry: TranscriptEntry = { kind: 'user', seq: e.seq, text: e.text }
        this.state = { ...this.state, settled: [...this.state.settled, entry] }
        return
      }

      case 'assistant-message': {
        const entry: AssistantEntry = { kind: 'assistant', seq: e.seq, text: e.text, reasoning: e.reasoning }
        const settled = [...this.state.settled, entry]
        const live = this.state.live
        this.state = live
          ? { ...this.state, settled, live: { ...live, text: '', reasoning: '' } }
          : { ...this.state, settled }
        return
      }

      case 'turn-end': {
        const live = this.state.live
        let settled = this.state.settled
        if (live) {
          for (const tool of live.tools) {
            settled = [...settled, { ...tool, seq: e.seq }]
          }
          if (live.text !== '' || live.reasoning !== '') {
            const trailing: AssistantEntry = { kind: 'assistant', seq: e.seq, text: live.text, reasoning: live.reasoning }
            settled = [...settled, trailing]
          }
        }
        if (e.outcome === 'error') {
          settled = [...settled, this.notice(e.seq, 'error', e.errorMessage ?? '')]
        } else if (e.outcome === 'aborted') {
          settled = [...settled, this.notice(e.seq, 'info', 'turn interrupted')]
        }
        const { live: _droppedLive, ...rest } = this.state
        this.state = { ...rest, settled, status: { ...rest.status, running: false } }
        return
      }

      case 'request-header': {
        this.setStatus({ provider: e.provider, model: e.model })
        return
      }

      case 'other':
        return

      default: {
        const exhaustive: never = e
        return exhaustive
      }
    }
  }
}
