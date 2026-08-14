/**
 * View-model types the transcript store (`store.ts`) folds `ZealEvent`s into
 * and the TUI renders. Per Controller Ruling R1 on this task, the
 * `interaction` field the brief's `ZealViewState` sketch shows is omitted
 * here — Task 6 adds it (and the `PendingInteraction` type) alongside the
 * confirmation-flow store logic that produces it.
 * @module @zealagent/dsh-zeal/tui/model
 */

/** A settled user turn — the prompt the user sent. */
export interface UserEntry { kind: 'user'; seq: number; text: string }

/** A settled assistant turn — final text and reasoning, fully assembled. */
export interface AssistantEntry { kind: 'assistant'; seq: number; text: string; reasoning: string }

/** A tool invocation, either still running (in `LiveTurn.tools`) or settled. */
export interface ToolEntry {
  kind: 'tool'
  seq: number
  callId: string
  name: string
  args: string
  status: 'running' | 'ok' | 'error'
  preview: string
}

/** An out-of-band notice (turn errors, aborts, connection status, etc). */
export interface NoticeEntry { kind: 'notice'; seq: number; level: 'info' | 'error'; text: string }

/** Everything that can appear in `ZealViewState.settled`. */
export type TranscriptEntry = UserEntry | AssistantEntry | ToolEntry | NoticeEntry

/** The turn currently streaming in — not yet settled into the transcript. */
export interface LiveTurn { text: string; reasoning: string; tools: ToolEntry[] }

/** Header/status-bar state, independent of the transcript. */
export interface StatusModel {
  provider: string
  model: string
  title?: string
  running: boolean
  sandboxMode?: string
  retry?: string
  contextFill?: number
}

/** The full view model `ZealStore` exposes to the TUI. */
export interface ZealViewState {
  settled: readonly TranscriptEntry[]
  live?: LiveTurn
  status: StatusModel
}
