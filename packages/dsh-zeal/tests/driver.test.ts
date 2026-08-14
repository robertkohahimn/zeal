/**
 * TDD coverage for `ZealDriver` (Task 12) against a hand-rolled fake registry
 * implementing the consumed `@deepseek-ai/dsh-agent`/`dsh-session-query`
 * signatures. The fake never touches the real `AgentRegistry`/loop
 * machinery — it just records what `driver.ts` calls and hands back
 * caller-shaped values, so these tests exercise driver.ts's own logic
 * (message wrapping, selection-ref mutation, replay, title merging) rather
 * than the harness's turn loop.
 * @module @zealagent/dsh-zeal/tests/driver
 */

import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type {
  Agent,
  AgentCancelCause,
  AgentOptions,
  AgentSetup,
  CancelOptions,
  CreateAgentOptions,
  ModelSelection,
  ResumeAgentOptions,
} from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionRecord, SessionTitleObservationResult } from '@deepseek-ai/dsh-session-query'
import { ZealDriver } from '../src/tui/driver.ts'
import { ZealStore } from '../src/tui/store.ts'
import { fixtures } from './fixtures/events.ts'

/** One recorded `agentCtx.on(name, listener)` registration. */
interface OnCall { name: string; listener: (...args: unknown[]) => unknown }

/** A fake Agent-scoped context: records `setup`'s `.on()` registrations and lets tests fire them. */
class FakeAgentCtx {
  readonly calls: OnCall[] = []
  on(name: string, listener: (...args: unknown[]) => unknown): () => boolean {
    this.calls.push({ name, listener })
    return () => true
  }
  /** Fire every registered listener for `name` with `args` (simulates a live dispatch). */
  fire(name: string, ...args: unknown[]): void {
    for (const call of this.calls) if (call.name === name) call.listener(...args)
  }
}

/** A fake live Session: a mutable `events` array plus `firstLiveSeq`, matching the consumed surface. */
class FakeSession {
  constructor(public id: string, public events: SessionEvent[], public firstLiveSeq: number) {}
}

/** A fake live Agent recording every `followup`/`cancel` call it receives. */
class FakeAgent {
  readonly followupCalls: UserMessage[] = []
  readonly cancelCalls: Array<{ cause: AgentCancelCause; options: CancelOptions | undefined }> = []
  constructor(public session: FakeSession) {}
  followup(message: UserMessage): void {
    this.followupCalls.push(message)
  }
  cancel(cause: AgentCancelCause, options?: CancelOptions): void {
    this.cancelCalls.push({ cause, options })
  }
  async whenIdle(): Promise<void> {}
}

/** Records of every `create`/`resume` call the fake registry received, for assertions. */
interface RegistryCalls {
  create: CreateAgentOptions[]
  resume: ResumeAgentOptions[]
}

/** Build a fake `ctx.agents` that fabricates a `FakeAgent`, invoking `setup` exactly like the real factory. */
function fakeAgents(session: FakeSession, agentCtxCalls: FakeAgentCtx[]) {
  const calls: RegistryCalls = { create: [], resume: [] }
  const agentCtx = new FakeAgentCtx()
  agentCtxCalls.push(agentCtx)

  async function runSetup(setup: AgentSetup | undefined): Promise<void> {
    await setup?.(agentCtx as unknown as Context)
  }

  async function create(options: CreateAgentOptions): Promise<{ agent: Agent; dispose: () => Promise<void> }> {
    calls.create.push(options)
    await runSetup(options.setup)
    const agent = new FakeAgent(session)
    return { agent: agent as unknown as Agent, dispose: async () => {} }
  }

  async function resume(options: ResumeAgentOptions): Promise<{ agent: Agent; dispose: () => Promise<void> }> {
    calls.resume.push(options)
    await runSetup(options.setup)
    const agent = new FakeAgent(session)
    return { agent: agent as unknown as Agent, dispose: async () => {} }
  }

  return { agents: { create, resume }, calls }
}

/** A fake `ctx.sessionQuery` recording `listSessions`/`readTitleSnapshots` calls and returning canned results. */
function fakeSessionQuery(records: SessionRecord[], titleResults: SessionTitleObservationResult[]): {
  sessionQuery: { listSessions(): Promise<SessionRecord[]>; readTitleSnapshots(ids: readonly string[]): Promise<SessionTitleObservationResult[]> }
  readTitleSnapshotsCalls: readonly string[][]
} {
  const readTitleSnapshotsCalls: string[][] = []
  return {
    sessionQuery: {
      async listSessions() {
        return records
      },
      async readTitleSnapshots(ids: readonly string[]) {
        readTitleSnapshotsCalls.push([...ids])
        return titleResults
      },
    },
    readTitleSnapshotsCalls,
  }
}

/** Build a minimal fake `Context` exposing exactly the services `driver.ts` reads. */
function fakeCtx(parts: {
  agents: unknown
  agentDefaultModel: unknown
  sessionQuery?: unknown
  sessions?: unknown
}): Context {
  return {
    get: (_name: string) => undefined, // no 'loader' service mounted — start() must tolerate that
    agents: parts.agents,
    agentDefaultModel: parts.agentDefaultModel,
    sessionQuery: parts.sessionQuery,
    sessions: parts.sessions,
  } as unknown as Context
}

const DEFAULT_SELECTION: ModelSelection = { provider: 'zai', model: 'glm-5.2' }
function fakeDefaultModel(selection: ModelSelection = DEFAULT_SELECTION): { currentSelection(): ModelSelection } {
  return { currentSelection: () => selection }
}

describe('ZealDriver', () => {
  it('(a) start installs the model selection and subscribes to session/event before returning', async () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    const agentCtxCalls: FakeAgentCtx[] = []
    const { agents } = fakeAgents(new FakeSession('s1', [], 0), agentCtxCalls)
    const ctx = fakeCtx({ agents, agentDefaultModel: fakeDefaultModel() })

    await ZealDriver.start(ctx, store, {})

    const agentCtx = agentCtxCalls[0]!
    const names = agentCtx.calls.map(c => c.name)
    // installModelSelection registers these two waterfall listeners...
    expect(names).toContain('system-prompt/assemble')
    expect(names).toContain('agent/request')
    // ...and driver.ts registers its own store-feeding subscription.
    expect(names).toContain('session/event')

    // Prove the subscription actually pipes into the store: fire it directly.
    agentCtx.fire('session/event', {}, fixtures.turnStart(1))
    expect(store.getState().status.running).toBe(true)
  })

  it('(a) start overrides the default selection with opts.model when given', async () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    const agentCtxCalls: FakeAgentCtx[] = []
    const { agents, calls } = fakeAgents(new FakeSession('s1', [], 0), agentCtxCalls)
    const ctx = fakeCtx({ agents, agentDefaultModel: fakeDefaultModel({ provider: 'zai', model: 'glm-5.2' }) })

    await ZealDriver.start(ctx, store, { model: 'glm-4.7' })

    const created = calls.create[0]!
    const options = created.agentOptions as AgentOptions
    expect(options.provider).toBe('zai')
    expect(options.model).toBe('glm-4.7')
  })

  it('(b) send wraps text in a user message and calls agent.followup', async () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    const agentCtxCalls: FakeAgentCtx[] = []
    const fakeAgent = new FakeAgent(new FakeSession('s1', [], 0))
    const { agents } = fakeAgentsReturning(fakeAgent, agentCtxCalls)
    const ctx = fakeCtx({ agents, agentDefaultModel: fakeDefaultModel() })

    const driver = await ZealDriver.start(ctx, store, {})
    driver.send('hello there')

    expect(fakeAgent.followupCalls).toHaveLength(1)
    expect(fakeAgent.followupCalls[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'hello there' }],
      source: { kind: 'user' },
    })
  })

  it('(c) interrupt calls cancel with {kind: "user"}, {keepInbox: true}', async () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    const agentCtxCalls: FakeAgentCtx[] = []
    const fakeAgent = new FakeAgent(new FakeSession('s1', [], 0))
    const { agents } = fakeAgentsReturning(fakeAgent, agentCtxCalls)
    const ctx = fakeCtx({ agents, agentDefaultModel: fakeDefaultModel() })

    const driver = await ZealDriver.start(ctx, store, {})
    driver.interrupt()

    expect(fakeAgent.cancelCalls).toEqual([{ cause: { kind: 'user' }, options: { keepInbox: true } }])
  })

  it('(d) resume replays seed events into the store exactly once', async () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    const agentCtxCalls: FakeAgentCtx[] = []
    const seed = [fixtures.turnStart(1), fixtures.userMessage('remembered fact', 2), fixtures.turnEnd('completed', 3)]
    const session = new FakeSession('resumed-session', seed, 3)
    const { agents, calls } = fakeAgents(session, agentCtxCalls)
    const ctx = fakeCtx({ agents, agentDefaultModel: fakeDefaultModel() })

    await ZealDriver.start(ctx, store, { resumeSessionId: 'resumed-session' })

    expect(calls.resume).toHaveLength(1)
    expect(calls.resume[0]!.resumeSessionId).toBe('resumed-session')

    const settled = store.getState().settled
    const userEntries = settled.filter(e => e.kind === 'user')
    expect(userEntries).toHaveLength(1)
    expect(userEntries[0]).toMatchObject({ text: 'remembered fact' })

    // The guard makes a duplicate application of the same seed event a no-op —
    // proving replay is exactly-once even under overlap.
    store.apply(fixtures.userMessage('remembered fact', 2))
    expect(store.getState().settled.filter(e => e.kind === 'user')).toHaveLength(1)
  })

  it('(CRITICAL-1) resume replays a seed starting at seq 0 without dropping it', async () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    const agentCtxCalls: FakeAgentCtx[] = []
    // Session.seq is the log length, so a session's very first event is seq
    // 0. Deliberately no turn/end here: a dropped turn/start(0) would be
    // masked once a later turn/end clears `live` anyway, so this seed leaves
    // `live` observable after replay — a store that dropped the seq-0 event
    // (the `lastSeq = 0` bug) would leave `live` `undefined` here instead.
    const seed = [fixtures.turnStart(0), fixtures.userMessage('seq zero fact', 1)]
    const session = new FakeSession('resumed-from-zero', seed, 2)
    const { agents, calls } = fakeAgents(session, agentCtxCalls)
    const ctx = fakeCtx({ agents, agentDefaultModel: fakeDefaultModel() })

    await ZealDriver.start(ctx, store, { resumeSessionId: 'resumed-from-zero' })

    expect(calls.resume).toHaveLength(1)
    const state = store.getState()
    expect(state.live).toEqual({ text: '', reasoning: '', tools: [] })
    const userEntries = state.settled.filter(e => e.kind === 'user')
    expect(userEntries).toHaveLength(1)
    expect(userEntries[0]).toMatchObject({ text: 'seq zero fact' })
  })

  it('(IMPORTANT-4) a live event delivered before replay does not lose the seed, and is not itself lost', async () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    const seed = [fixtures.turnStart(1), fixtures.userMessage('seeded fact', 2), fixtures.turnEnd('completed', 3)]
    const session = new FakeSession('race-session', seed, 3)
    const agentCtx = new FakeAgentCtx()
    // A "live" event with a higher seq than anything in the seed — arrives
    // WHILE resume() is still pending, i.e. before driver.ts's replay loop
    // (which only runs after resume()'s returned promise settles) has run.
    const liveEvent = fixtures.requestHeader('late-provider', 'late-model', 4)

    const agents = {
      create: async (): Promise<{ agent: Agent; dispose: () => Promise<void> }> => {
        throw new Error('create should not be called in this test')
      },
      resume: async (options: ResumeAgentOptions): Promise<{ agent: Agent; dispose: () => Promise<void> }> => {
        await options.setup?.(agentCtx as unknown as Context)
        // Simulate the race: a live dispatch fires before this resume() call
        // (and therefore driver.ts's replay loop) has returned.
        agentCtx.fire('session/event', {}, liveEvent)
        return { agent: new FakeAgent(session) as unknown as Agent, dispose: async () => {} }
      },
    }
    const ctx = fakeCtx({ agents, agentDefaultModel: fakeDefaultModel() })

    await ZealDriver.start(ctx, store, { resumeSessionId: 'race-session' })

    const state = store.getState()
    const userEntries = state.settled.filter(e => e.kind === 'user')
    // The seed must still be fully present — this is the assertion that
    // would fail (empty array) under the pre-fix bug, where the early live
    // event bumps lastSeq past the whole seed range before replay runs.
    expect(userEntries).toHaveLength(1)
    expect(userEntries[0]).toMatchObject({ text: 'seeded fact' })
    // The live event itself must not be lost either — it lands right after
    // the seed once the buffer is released.
    expect(state.status.provider).toBe('late-provider')
    expect(state.status.model).toBe('late-model')

    // No duplicates: re-applying a seed event afterward is still a no-op.
    store.apply(fixtures.userMessage('seeded fact', 2))
    expect(store.getState().settled.filter(e => e.kind === 'user')).toHaveLength(1)
  })

  it('(e) listSessions merges titles onto rows and drops failed/absent titles', async () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    const agentCtxCalls: FakeAgentCtx[] = []
    const { agents } = fakeAgents(new FakeSession('s1', [], 0), agentCtxCalls)

    const records = [
      { header: { id: 'sess-1', createdAt: 1000 }, live: true, persisted: true },
      { header: { id: 'sess-2', createdAt: 2000 }, live: false, persisted: true },
    ] as unknown as SessionRecord[]
    const titleResults = [
      {
        sessionId: 'sess-1',
        status: 'fulfilled' as const,
        value: { session: {}, title: { title: 'Fix the bug', messageSeqs: [1], source: 'model', eventSeq: 4, updatedAt: 1 } },
      },
      { sessionId: 'sess-2', status: 'rejected' as const, reason: new Error('no title yet') },
    ] as unknown as SessionTitleObservationResult[]
    const { sessionQuery, readTitleSnapshotsCalls } = fakeSessionQuery(records, titleResults)

    const ctx = fakeCtx({ agents, agentDefaultModel: fakeDefaultModel(), sessionQuery })
    const driver = await ZealDriver.start(ctx, store, {})

    const rows = await driver.listSessions()

    expect(rows).toEqual([
      { sessionId: 'sess-1', title: 'Fix the bug', createdAt: 1000, live: true },
      { sessionId: 'sess-2', createdAt: 2000, live: false },
    ])
    expect(readTitleSnapshotsCalls[0]).toEqual(['sess-1', 'sess-2'])
  })

  it('(e) listSessions honors limit, requesting titles only for the sliced rows', async () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    const agentCtxCalls: FakeAgentCtx[] = []
    const { agents } = fakeAgents(new FakeSession('s1', [], 0), agentCtxCalls)

    const records = [
      { header: { id: 'sess-1', createdAt: 3000 }, live: true, persisted: true },
      { header: { id: 'sess-2', createdAt: 2000 }, live: false, persisted: true },
      { header: { id: 'sess-3', createdAt: 1000 }, live: false, persisted: true },
    ] as unknown as SessionRecord[]
    const { sessionQuery, readTitleSnapshotsCalls } = fakeSessionQuery(records, [])

    const ctx = fakeCtx({ agents, agentDefaultModel: fakeDefaultModel(), sessionQuery })
    const driver = await ZealDriver.start(ctx, store, {})

    const rows = await driver.listSessions(1)

    expect(rows).toEqual([{ sessionId: 'sess-1', createdAt: 3000, live: true }])
    expect(readTitleSnapshotsCalls[0]).toEqual(['sess-1'])
  })

  it('switchModel mutates the live selection ref, defaulting provider to the current one', async () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    const agentCtxCalls: FakeAgentCtx[] = []
    const { agents } = fakeAgents(new FakeSession('s1', [], 0), agentCtxCalls)
    const ctx = fakeCtx({ agents, agentDefaultModel: fakeDefaultModel({ provider: 'zai', model: 'glm-5.2' }) })

    const driver = await ZealDriver.start(ctx, store, {})
    driver.switchModel('glm-4.7')
    driver.switchModel('glm-6', 'other-provider')

    // Selection is internal; observe its effect indirectly through a fresh
    // agentCtx.fire of the request waterfall installModelSelection wired up.
    const agentCtx = agentCtxCalls[0]!
    const assembleListener = agentCtx.calls.find(c => c.name === 'system-prompt/assemble')!.listener
    const result = await assembleListener({}, {}, async () => ({ variables: {} })) as { variables: { provider: string; model: string } }
    expect(result.variables.provider).toBe('other-provider')
    expect(result.variables.model).toBe('glm-6')
  })

  it('(IMPORTANT-2a) switchModel clears any reasoningEffort carried on the previous selection', async () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    const agentCtxCalls: FakeAgentCtx[] = []
    const selectionWithEffort = { provider: 'zai', model: 'glm-5.2', reasoningEffort: 'high' } as unknown as ModelSelection
    const { agents } = fakeAgents(new FakeSession('s1', [], 0), agentCtxCalls)
    const ctx = fakeCtx({ agents, agentDefaultModel: fakeDefaultModel(selectionWithEffort) })

    const driver = await ZealDriver.start(ctx, store, {})
    const agentCtx = agentCtxCalls[0]!
    const assembleListener = agentCtx.calls.find(c => c.name === 'system-prompt/assemble')!.listener
    const requestListener = agentCtx.calls.find(c => c.name === 'agent/request')!.listener

    // Baseline: the initial selection's effort flows through to the
    // resolved request config before any switch.
    await assembleListener({}, {}, async () => ({ variables: {} }))
    const before = await requestListener({}, async () => ({ provider: 'old', model: 'old', reasoningEffort: 'high' })) as Record<string, unknown>
    expect(before['reasoningEffort']).toBe('high')

    driver.switchModel('glm-6')

    // installModelSelection's `agent/request` handler only clears an
    // inherited effort when the SELECTED (assembled) selection omits the
    // key entirely — re-fire assemble so `selection.assembled` reflects the
    // post-switch selection, then request again.
    await assembleListener({}, {}, async () => ({ variables: {} }))
    const after = await requestListener({}, async () => ({ provider: 'old', model: 'old', reasoningEffort: 'high' })) as Record<string, unknown>
    expect('reasoningEffort' in after).toBe(false)
  })

  it('(IMPORTANT-2b) an unchanged selection keeps its reasoningEffort across requests', async () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    const agentCtxCalls: FakeAgentCtx[] = []
    const selectionWithEffort = { provider: 'zai', model: 'glm-5.2', reasoningEffort: 'high' } as unknown as ModelSelection
    const { agents } = fakeAgents(new FakeSession('s1', [], 0), agentCtxCalls)
    const ctx = fakeCtx({ agents, agentDefaultModel: fakeDefaultModel(selectionWithEffort) })

    await ZealDriver.start(ctx, store, {})
    const agentCtx = agentCtxCalls[0]!
    const assembleListener = agentCtx.calls.find(c => c.name === 'system-prompt/assemble')!.listener
    const requestListener = agentCtx.calls.find(c => c.name === 'agent/request')!.listener

    await assembleListener({}, {}, async () => ({ variables: {} }))
    const result = await requestListener({}, async () => ({ provider: 'old', model: 'old' })) as Record<string, unknown>
    expect(result['reasoningEffort']).toBe('high')
  })

  it('flush calls ctx.sessions.flush with the live agent session', async () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    const agentCtxCalls: FakeAgentCtx[] = []
    const session = new FakeSession('flush-session', [], 0)
    const fakeAgent = new FakeAgent(session)
    const { agents } = fakeAgentsReturning(fakeAgent, agentCtxCalls)
    const flushCalls: FakeSession[] = []
    const sessions = { flush: async (s: FakeSession) => { flushCalls.push(s); return true } }
    const ctx = fakeCtx({ agents, agentDefaultModel: fakeDefaultModel(), sessions })

    const driver = await ZealDriver.start(ctx, store, {})
    await driver.flush()

    expect(flushCalls).toEqual([session])
  })
})

/** Like `fakeAgents`, but always resolves `create`/`resume` with the exact `agent` provided (for tests that need to inspect its recorded calls). */
function fakeAgentsReturning(fakeAgent: FakeAgent, agentCtxCalls: FakeAgentCtx[]): {
  agents: { create: (options: CreateAgentOptions) => Promise<{ agent: Agent; dispose: () => Promise<void> }>; resume: (options: ResumeAgentOptions) => Promise<{ agent: Agent; dispose: () => Promise<void> }> }
} {
  const agentCtx = new FakeAgentCtx()
  agentCtxCalls.push(agentCtx)
  async function runSetup(setup: AgentSetup | undefined): Promise<void> {
    await setup?.(agentCtx as unknown as Context)
  }
  return {
    agents: {
      create: async (options: CreateAgentOptions) => {
        await runSetup(options.setup)
        return { agent: fakeAgent as unknown as Agent, dispose: async () => {} }
      },
      resume: async (options: ResumeAgentOptions) => {
        await runSetup(options.setup)
        return { agent: fakeAgent as unknown as Agent, dispose: async () => {} }
      },
    },
  }
}
