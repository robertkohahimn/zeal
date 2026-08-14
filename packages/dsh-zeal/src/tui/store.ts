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
import type { AssistantEntry, NoticeEntry, StatusModel, ToolEntry, TranscriptEntry, ZealViewState } from './model.ts'

/** Listener notifications are coalesced onto this interval. */
const NOTIFY_COALESCE_MS = 16

export class ZealStore {
  private state: ZealViewState
  private lastSeq = 0
  private readonly listeners = new Set<() => void>()
  private timer: ReturnType<typeof setTimeout> | undefined

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
    this.state = { ...this.state, settled: [...this.state.settled, this.notice(this.lastSeq, level, text)] }
    this.scheduleNotify()
  }

  /** Merge a partial patch into the status-bar model. */
  setStatus(patch: Partial<StatusModel>): void {
    this.state = { ...this.state, status: { ...this.state.status, ...patch } }
    this.scheduleNotify()
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
          if (live.text !== '') {
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
        this.state = { ...this.state, status: { ...this.state.status, provider: e.provider, model: e.model } }
        return
      }

      case 'other':
        return
    }
  }
}
