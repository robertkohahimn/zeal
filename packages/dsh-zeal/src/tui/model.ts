/**
 * View-model types the transcript store (`store.ts`) folds `ZealEvent`s into
 * and the TUI renders. Per Controller Ruling R1, the `interaction` field and
 * `PendingInteraction` type were deliberately left out of Task 5 and added
 * here in Task 6, alongside the confirmation-flow queue logic in `store.ts`
 * that produces and settles them.
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

/** A yes/no approval request — e.g. "allow this tool call?" */
export interface ApprovalPrompt { kind: 'approval'; id: number; title: string; detail: string; agentLabel: string }

/** One selectable choice within a `QuestionItem`. */
export interface QuestionOption { label: string; description?: string }

/** One question within a `QuestionsPrompt` — may allow multiple selections or a plan review. */
export interface QuestionItem {
  id: string
  question: string
  detail?: string
  header?: string
  options: QuestionOption[]
  multiSelect: boolean
  planReview: boolean
}

/** A batch of questions posed to the user together (e.g. a plan-review checkpoint). */
export interface QuestionsPrompt { kind: 'questions'; id: number; items: QuestionItem[] }

/** Whatever the store currently needs the user to resolve before the agent can proceed. */
export type PendingInteraction = ApprovalPrompt | QuestionsPrompt

/** The user's answer to an `ApprovalPrompt`. */
export type ApprovalDecision = 'allow-once' | 'reject'

/** The user's answer to one `QuestionItem` within a `QuestionsPrompt`. */
export interface QuestionAnswer { id: string; selected: string[]; custom?: string }

/** The full view model `ZealStore` exposes to the TUI. */
export interface ZealViewState {
  settled: readonly TranscriptEntry[]
  live?: LiveTurn
  status: StatusModel
  interaction?: PendingInteraction
}
