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
 * makes any theoretical overlap between the seed replay and a live dispatch a
 * no-op — PROVIDED the seed lands first. It does not on its own: `setup`'s
 * `session/event` listener is live from the moment it registers (before
 * either `create`/`resume` returns), so a live event dispatched while `start`
 * is still awaiting that promise would otherwise reach the store BEFORE the
 * seed replay loop runs below, bumping `lastSeq` past the whole seed range
 * and silently dropping it (not deduping it — losing it). `start` closes that
 * window by buffering every live `session/event` behind `liveBuffered`/
 * `bufferingLive` until the seed replay (or, for a fresh `create`, the
 * no-op equivalent) completes, then drains the buffer in arrival order. Seed
 * events always have lower seqs than anything buffered this way, so replay-
 * then-drain is already the correct ascending-seq order.
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
import type { SessionEvent } from '@deepseek-ai/dsh-session'
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
  /** The full live Agent — also exposed publicly as `agent` (see its doc comment for why). */
  private readonly liveAgent: Agent
  private readonly ctx: Context
  private readonly selection: ModelSelectionRef
  /** The `AgentHandle.dispose` this driver's `create`/`resume` call minted — see `dispose()`. */
  private readonly disposeHandle: () => Promise<void>

  /**
   * The live Agent this driver drives. Widened from Task 12's original
   * quiescence-only `{ whenIdle(): Promise<void> }` view: Task 14's assembly
   * needs the real `Agent` too — `ctx.commands.list(agent)`/`execute(agent,
   * ...)` (the `CommandDispatcher` seam, `commands.ts`) require the actual
   * `Agent` identity, not a narrowed stand-in, and `agent.session` is what
   * the optional `sandboxPolicy`/`sessionTitle` services resolve/poll
   * against. No test or caller relied on the narrower type (grepped before
   * widening), so this is a pure widening, not a behavior change.
   */
  readonly agent: Agent

  private constructor(ctx: Context, selection: ModelSelectionRef, liveAgent: Agent, disposeHandle: () => Promise<void>) {
    this.ctx = ctx
    this.selection = selection
    this.liveAgent = liveAgent
    this.agent = liveAgent
    this.disposeHandle = disposeHandle
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

    // See the module doc's "live-before-replay" note: buffer every live
    // `session/event` until the seed replay below (or its create-path no-op)
    // completes, so a live dispatch that arrives while `create`/`resume` is
    // still pending can never overtake — and thereby erase — the seed.
    let bufferingLive = true
    const liveBuffered: SessionEvent[] = []

    const setup = (agentCtx: Context): void => {
      installModelSelection(agentCtx, selection)
      agentCtx.on('session/event', (_session, event) => {
        if (bufferingLive) liveBuffered.push(event)
        else store.apply(event)
      })
    }

    const releaseBufferedLive = (): void => {
      bufferingLive = false
      for (const event of liveBuffered) store.apply(event)
      liveBuffered.length = 0
    }

    if (opts.resumeSessionId !== undefined) {
      const { agent, dispose } = await ctx.agents.resume({
        resumeSessionId: SessionId(opts.resumeSessionId),
        agentOptions,
        setup,
      })
      // The resumed session's persisted history never crossed the
      // `session/event` firehose (see module doc); replay it once now, THEN
      // release anything buffered above — seed seqs are always lower, so
      // this order is already correct ascending-seq order.
      for (const event of agent.session.events) store.apply(event)
      releaseBufferedLive()
      return new ZealDriver(ctx, selection, agent, dispose)
    }

    const { agent, dispose } = await ctx.agents.create({
      sessionId: SessionId(`session-${randomUUID()}`),
      meta: { cwd: process.cwd() },
      agentOptions,
      setup,
    })
    releaseBufferedLive()
    return new ZealDriver(ctx, selection, agent, dispose)
  }

  /** Queue `text` as an ordinary follow-up turn. The store shows the user entry via the resulting `user/message` session event. */
  send(text: string): void {
    this.liveAgent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  }

  /** Abort the active turn while preserving queued/steering work. */
  interrupt(): void {
    this.liveAgent.cancel({ kind: 'user' }, { keepInbox: true })
  }

  /**
   * Mutate the live selection ref; the next step's prompt assembly and
   * request config pick it up.
   *
   * Deliberately drops any carried `reasoningEffort`: effort is
   * adapter/model-owned, so a value tuned for the old model is not assumed
   * valid for the new one. `installModelSelection`'s `agent/request`
   * handler documents exactly this path — "an absent selected effort clears
   * any inherited effort, restoring the selected model's provider/default
   * behavior" — which only fires when the new selection omits
   * `reasoningEffort` entirely, not merely sets it to `undefined`.
   */
  switchModel(model: string, provider?: string): void {
    const current = this.selection.current
    this.selection.current = { provider: provider ?? current?.provider ?? '', model }
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

  /**
   * Tear down this driver's live Agent: stop its loop, await exit,
   * unregister it, and unwind its scoped world (`AgentHandle.dispose`'s
   * contract — see `@deepseek-ai/dsh-agent`'s `index.d.ts`). Carry-forward
   * from Task 12's review: `start()` previously discarded the
   * `AgentHandle.dispose` capability entirely, so a session-switch/`/resume`
   * restart had no way to retire the agent it was replacing — leaking its
   * loop and scope. Callers that replace this driver (e.g. an assembly-level
   * `/resume` restart) MUST await this before starting the replacement.
   * Idempotent only to the extent the underlying `AgentHandle.dispose` is;
   * this driver does not itself guard against a second call.
   */
  async dispose(): Promise<void> {
    await this.disposeHandle()
  }
}
