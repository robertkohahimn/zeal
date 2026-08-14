/**
 * The turn driver: the integration heart of the TUI. It creates or resumes a
 * real dsh `Agent` through the verified registry surface
 * (`ctx.agents.create`/`ctx.agents.resume`, `installModelSelection`,
 * `agent.followup`/`cancel`/`whenIdle`), pipes its live `session/event`
 * firehose into `ZealStore.apply`, and exposes the small imperative surface
 * (`send`/`interrupt`/`switchModel`/`listSessions`/`flush`) the TUI's input
 * loop and picker screens call.
 *
 * `setup(agentCtx)` runs BEFORE either the session or the agent is announced
 * (`AgentSetup`'s documented ordering — see `@deepseek-ai/dsh-agent`'s
 * `CreateAgentOptions.setup`/`ResumeAgentOptions.setup`), so both
 * `installModelSelection` and the `session/event` subscription are in place
 * before any live event can be missed.
 *
 * Resume is special: a session's constructor seed (its persisted history) is
 * loaded into `agent.session.events` WITHOUT ever publishing on the
 * `session/event` firehose (`Session.firstLiveSeq`'s doc comment — "constructor
 * seeds do not emit"). `start` replays that seed into the store once the
 * handle resolves; `ZealStore.apply`'s `seq <= lastSeq` guard (`store.ts`)
 * makes any theoretical overlap with a later live dispatch a no-op, so the
 * replay never needs its own dedup bookkeeping.
 * @module @zealagent/dsh-zeal/tui/driver
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentOptions, ModelSelection, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
// Empty type import carries the `ctx.agentDefaultModel` Context merge — the
// service itself is wired into `ctx` by the bundle, never constructed here.
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionRecord, SessionTitleObservationResult } from '@deepseek-ai/dsh-session-query'
import type { ZealStore } from './store.ts'

/** One row in the session picker: a persisted or live session, title-merged. */
export interface PickerRow {
  sessionId: string
  title?: string
  createdAt: number
  live: boolean
}

/** Merge `readTitleSnapshots` results onto their requested session id, dropping failures/absent titles. */
function titlesById(results: readonly SessionTitleObservationResult[]): Map<string, string> {
  const byId = new Map<string, string>()
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value.title !== undefined) {
      byId.set(result.sessionId, result.value.title.title)
    }
  }
  return byId
}

/** Project one `SessionRecord` plus its optional folded title into a `PickerRow`. */
function toPickerRow(record: SessionRecord, title: string | undefined): PickerRow {
  const row: PickerRow = { sessionId: record.header.id, createdAt: record.header.createdAt, live: record.live }
  if (title !== undefined) row.title = title
  return row
}

/**
 * Drives one live `Agent` for the TUI. Construct with the static `start`
 * factory (never directly — publication must complete before any method is
 * safe to call).
 */
export class ZealDriver {
  /** The full live Agent — kept private so the driver alone owns the drive surface. */
  private readonly liveAgent: Agent
  private readonly ctx: Context
  private readonly selection: ModelSelectionRef

  /** The narrow public view the brief's contract exposes: quiescence only. */
  readonly agent: { whenIdle(): Promise<void> }

  private constructor(ctx: Context, selection: ModelSelectionRef, liveAgent: Agent) {
    this.ctx = ctx
    this.selection = selection
    this.liveAgent = liveAgent
    this.agent = liveAgent
  }

  /**
   * Create or resume the live Agent for one TUI session.
   * @param ctx - the bundle's root context, carrying `agents`, `agentDefaultModel`, `sessionQuery`, `sessions`, and (optionally) `loader`.
   * @param store - the transcript store that folds this agent's `session/event` firehose.
   * @param opts - `resumeSessionId` to resume a persisted session, `model` to override the default model's id.
   * @returns a driver bound to the newly created or resumed agent.
   */
  static async start(
    ctx: Context,
    store: ZealStore,
    opts: { resumeSessionId?: string; model?: string },
  ): Promise<ZealDriver> {
    // Loader siblings mount concurrently; await the complete application
    // before creating an Agent so its scoped tools/adapters are not
    // half-composed (mirrors packages/bundle/headless/src/index.ts:99).
    await ctx.get('loader')?.await()

    const defaultSelection = ctx.agentDefaultModel.currentSelection()
    const initial: ModelSelection = opts.model !== undefined
      ? { ...defaultSelection, model: opts.model }
      : defaultSelection
    const selection: ModelSelectionRef = { current: initial, assembled: undefined }
    const agentOptions: AgentOptions = { provider: initial.provider, model: initial.model }

    const setup = (agentCtx: Context): void => {
      installModelSelection(agentCtx, selection)
      agentCtx.on('session/event', (_session, event) => {
        store.apply(event)
      })
    }

    if (opts.resumeSessionId !== undefined) {
      const { agent } = await ctx.agents.resume({
        resumeSessionId: SessionId(opts.resumeSessionId),
        agentOptions,
        setup,
      })
      // The resumed session's persisted history never crossed the
      // `session/event` firehose (see module doc); replay it once now. The
      // store's seq guard makes this safe even if a live dispatch also
      // covers part of this range.
      for (const event of agent.session.events) store.apply(event)
      return new ZealDriver(ctx, selection, agent)
    }

    const { agent } = await ctx.agents.create({
      sessionId: SessionId(`session-${randomUUID()}`),
      meta: { cwd: process.cwd() },
      agentOptions,
      setup,
    })
    return new ZealDriver(ctx, selection, agent)
  }

  /** Queue `text` as an ordinary follow-up turn. The store shows the user entry via the resulting `user/message` session event. */
  send(text: string): void {
    this.liveAgent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  }

  /** Abort the active turn while preserving queued/steering work. */
  interrupt(): void {
    this.liveAgent.cancel({ kind: 'user' }, { keepInbox: true })
  }

  /** Mutate the live selection ref; the next step's prompt assembly and request config pick it up. */
  switchModel(model: string, provider?: string): void {
    const current = this.selection.current
    const next: ModelSelection = { provider: provider ?? current?.provider ?? '', model }
    if (current?.reasoningEffort !== undefined) next.reasoningEffort = current.reasoningEffort
    this.selection.current = next
  }

  /**
   * List persisted/live sessions for the picker, newest-first (per
   * `sessionQuery.listSessions`'s contract), with folded titles merged on.
   * @param limit - cap the number of rows returned; omitted returns every session.
   */
  async listSessions(limit?: number): Promise<PickerRow[]> {
    const records = await this.ctx.sessionQuery.listSessions()
    const limited = limit !== undefined ? records.slice(0, limit) : records
    if (limited.length === 0) return []
    const ids = limited.map(record => record.header.id)
    const titleResults = await this.ctx.sessionQuery.readTitleSnapshots(ids)
    const byId = titlesById(titleResults)
    return limited.map(record => toPickerRow(record, byId.get(record.header.id)))
  }

  /** Flush this agent's session to durable storage. */
  async flush(): Promise<void> {
    await this.ctx.sessions.flush(this.liveAgent.session)
  }
}
