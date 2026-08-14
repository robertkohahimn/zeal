/**
 * Unit coverage for `tui/index.ts`'s pure/testable pieces —
 * `onboardingNotice`, `defaultLogPath`, `performQuit` (the on-quit
 * lifecycle, factored out so it's testable without mounting Ink), and
 * `resumeDriver` (the `/resume` restart, an "assembly-level" test against a
 * hand-rolled fake `ctx` at the same fidelity `tests/driver.test.ts` already
 * uses for `ZealDriver` itself — proving `store.reset()` actually runs
 * before the replacement `ZealDriver.start()`, the Task 14 review's CRITICAL
 * finding). `apply()`/`bootZealTui()` as a whole still need a full fake
 * `ctx` PLUS a mounted Ink instance to exercise meaningfully; per this
 * task's brief, that whole-plugin integration is verified later when Task
 * 16 boots the real bundle, not unit-tested here.
 * @module @zealagent/dsh-zeal/tests/tui-index
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
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
import { defaultLogPath, onboardingNotice, performQuit, resumeDriver } from '../src/tui/index.ts'
import { ZealDriver } from '../src/tui/driver.ts'
import { ZealStore } from '../src/tui/store.ts'
import { fixtures } from './fixtures/events.ts'

describe('onboardingNotice', () => {
  it('names ZAI_API_KEY for the zai route', () => {
    const text = onboardingNotice('zai')
    expect(text).toContain('No API key found for the zai route.')
    expect(text).toContain('Set ZAI_API_KEY in your environment')
    expect(text).toContain('$DSH_HOME/.credentials.yaml')
    expect(text).toContain('$DSH_HOME/settings.yaml under llm-pi-ai:')
  })

  it('names ZHIPU_API_KEY for the zai-coding-cn route', () => {
    const text = onboardingNotice('zai-coding-cn')
    expect(text).toContain('No API key found for the zai-coding-cn route.')
    expect(text).toContain('Set ZHIPU_API_KEY in your environment')
  })

  it('falls back gracefully for an unrecognized route rather than naming a wrong env var', () => {
    const text = onboardingNotice('some-future-route')
    expect(text).toContain('No API key found for the some-future-route route.')
    expect(text).not.toContain('ZAI_API_KEY')
    expect(text).not.toContain('ZHIPU_API_KEY')
  })
})

describe('defaultLogPath', () => {
  const originalDshHome = process.env['DSH_HOME']

  afterEach(() => {
    if (originalDshHome === undefined) delete process.env['DSH_HOME']
    else process.env['DSH_HOME'] = originalDshHome
  })

  it('derives the log path from DSH_HOME when set', () => {
    process.env['DSH_HOME'] = '/tmp/my-dsh-home'
    expect(defaultLogPath()).toBe('/tmp/my-dsh-home/profiles/zeal/logs/zeal.log')
  })

  it('falls back to ~/.dsh when DSH_HOME is unset', () => {
    delete process.env['DSH_HOME']
    const path = defaultLogPath()
    expect(path.endsWith('/.dsh/profiles/zeal/logs/zeal.log')).toBe(true)
  })
})

interface FakeQuitDriver {
  interrupt(): void
  flush(): Promise<void>
  agent: { whenIdle(): Promise<void> }
}

describe('performQuit', () => {
  it('runs the full sequence in order: unmount, interrupt, quiesce, flush, restoreStdio, appExit(0)', async () => {
    const order: string[] = []
    const driver: FakeQuitDriver = {
      interrupt: () => order.push('interrupt'),
      flush: async () => { order.push('flush') },
      agent: { whenIdle: async () => { order.push('whenIdle') } },
    }
    const appExitCalls: number[] = []
    await performQuit({
      unmount: () => order.push('unmount'),
      driver,
      restoreStdio: () => order.push('restoreStdio'),
      appExit: (code) => appExitCalls.push(code),
    })
    expect(order).toEqual(['unmount', 'interrupt', 'whenIdle', 'flush', 'restoreStdio'])
    expect(appExitCalls).toEqual([0])
  })

  it('(IMPORTANT 2) a rejecting flush() still restores stdio and calls appExit(0)', async () => {
    const restoreCalls: number[] = []
    const appExitCalls: number[] = []
    const driver: FakeQuitDriver = {
      interrupt: () => {},
      flush: async () => { throw new Error('flush boom') },
      agent: { whenIdle: async () => {} },
    }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    await performQuit({
      unmount: () => {},
      driver,
      restoreStdio: () => restoreCalls.push(1),
      appExit: (code) => appExitCalls.push(code),
    })
    expect(restoreCalls).toEqual([1])
    expect(appExitCalls).toEqual([0])
    // Logged (to the diagnostics log, since this fires before restoreStdio in
    // real usage) rather than left as an unhandled rejection.
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('(IMPORTANT 2) tolerates appExit being undefined (it is optional on Context)', async () => {
    const restoreCalls: number[] = []
    const driver: FakeQuitDriver = {
      interrupt: () => {},
      flush: async () => { throw new Error('boom') },
      agent: { whenIdle: async () => {} },
    }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(
      performQuit({ unmount: () => {}, driver, restoreStdio: () => restoreCalls.push(1), appExit: undefined }),
    ).resolves.toBeUndefined()
    expect(restoreCalls).toEqual([1])
    consoleError.mockRestore()
  })

  it('(IMPORTANT 3) a whenIdle() that never resolves is bounded by the timeout — flush still runs', async () => {
    const order: string[] = []
    const driver: FakeQuitDriver = {
      interrupt: () => order.push('interrupt'),
      flush: async () => { order.push('flush') },
      agent: { whenIdle: () => new Promise<void>(() => {}) }, // never settles
    }
    await performQuit(
      {
        unmount: () => order.push('unmount'),
        driver,
        restoreStdio: () => order.push('restoreStdio'),
        appExit: () => order.push('appExit'),
      },
      20, // tiny override so this test doesn't wait the real 2s default
    )
    expect(order).toEqual(['unmount', 'interrupt', 'flush', 'restoreStdio', 'appExit'])
  })

  it('(IMPORTANT 3) a rejecting whenIdle() does not abort the sequence — flush still runs', async () => {
    const order: string[] = []
    const driver: FakeQuitDriver = {
      interrupt: () => order.push('interrupt'),
      flush: async () => { order.push('flush') },
      agent: { whenIdle: async () => { throw new Error('whenIdle boom') } },
    }
    await performQuit(
      {
        unmount: () => order.push('unmount'),
        driver,
        restoreStdio: () => order.push('restoreStdio'),
        appExit: () => order.push('appExit'),
      },
      20,
    )
    expect(order).toEqual(['unmount', 'interrupt', 'flush', 'restoreStdio', 'appExit'])
  })
})

// ---------------------------------------------------------------------------
// `resumeDriver` — the assembly-level CRITICAL 1 regression test, plus the
// standard driver-fake harness `tests/driver.test.ts` already established
// (duplicated here in trimmed form: `resumeDriver` additionally needs
// `ctx.commands` for `buildDispatcher` and `agent.ctx` for
// `wireDriverObservers`, neither of which `driver.test.ts`'s own fakes model).
// ---------------------------------------------------------------------------

interface OnCall { name: string; listener: (...args: unknown[]) => unknown }

class FakeAgentCtx {
  readonly calls: OnCall[] = []
  on(name: string, listener: (...args: unknown[]) => unknown): () => boolean {
    this.calls.push({ name, listener })
    return () => true
  }
  fire(name: string, ...args: unknown[]): void {
    for (const call of this.calls) if (call.name === name) call.listener(...args)
  }
}

class FakeSession {
  constructor(public id: string, public events: SessionEvent[], public firstLiveSeq: number) {}
}

class FakeAgent {
  readonly followupCalls: UserMessage[] = []
  readonly cancelCalls: Array<{ cause: AgentCancelCause; options: CancelOptions | undefined }> = []
  constructor(public session: FakeSession, public ctx: FakeAgentCtx) {}
  followup(message: UserMessage): void { this.followupCalls.push(message) }
  cancel(cause: AgentCancelCause, options?: CancelOptions): void { this.cancelCalls.push({ cause, options }) }
  async whenIdle(): Promise<void> {}
}

/** Fake `ctx.agents`: `create`/`resume` each mint a fresh `FakeAgentCtx`, run `setup` against it exactly like the real factory, and hand back the matching `FakeSession`. */
function fakeAgents(sessions: { create: FakeSession; resume: FakeSession }): {
  agents: {
    create(options: CreateAgentOptions): Promise<{ agent: Agent; dispose: () => Promise<void> }>
    resume(options: ResumeAgentOptions): Promise<{ agent: Agent; dispose: () => Promise<void> }>
  }
  agentCtxCalls: FakeAgentCtx[]
  disposeCalls: string[]
} {
  const agentCtxCalls: FakeAgentCtx[] = []
  const disposeCalls: string[] = []
  async function runSetup(setup: AgentSetup | undefined, agentCtx: FakeAgentCtx): Promise<void> {
    await setup?.(agentCtx as unknown as Context)
  }
  return {
    agentCtxCalls,
    disposeCalls,
    agents: {
      create: async (options: CreateAgentOptions) => {
        const agentCtx = new FakeAgentCtx()
        agentCtxCalls.push(agentCtx)
        await runSetup(options.setup, agentCtx)
        const agent = new FakeAgent(sessions.create, agentCtx)
        return { agent: agent as unknown as Agent, dispose: async () => { disposeCalls.push('create') } }
      },
      resume: async (options: ResumeAgentOptions) => {
        const agentCtx = new FakeAgentCtx()
        agentCtxCalls.push(agentCtx)
        await runSetup(options.setup, agentCtx)
        const agent = new FakeAgent(sessions.resume, agentCtx)
        return { agent: agent as unknown as Agent, dispose: async () => { disposeCalls.push('resume') } }
      },
    },
  }
}

const DEFAULT_SELECTION: ModelSelection = { provider: 'zai', model: 'glm-5.2' }

function fakeCtx(parts: { agents: unknown }): Context {
  return {
    get: (_name: string) => undefined,
    agents: parts.agents,
    agentDefaultModel: { currentSelection: () => DEFAULT_SELECTION },
    commands: { list: () => [], execute: async () => undefined },
  } as unknown as Context
}

describe('resumeDriver (assembly-level; CRITICAL 1 regression)', () => {
  it('disposes the retiring driver and starts the replacement via ctx.agents.resume', async () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    const firstSession = new FakeSession('first-session', [], 0)
    const secondSession = new FakeSession('second-session', [], 0)
    const { agents, disposeCalls } = fakeAgents({ create: firstSession, resume: secondSession })
    const ctx = fakeCtx({ agents })

    const firstDriver = await ZealDriver.start(ctx, store, {})
    expect(disposeCalls).toEqual([])

    const { driver: secondDriver } = await resumeDriver(ctx, store, firstDriver, 'second-session', () => {})

    expect(disposeCalls).toEqual(['create'])
    expect(secondDriver.agent.session).toBe(secondSession)
  })

  // THE regression test: without `store.reset()` running before the
  // replacement `ZealDriver.start()`, the resumed session's seq-0/seq-1
  // seed would be silently dropped by `apply()`'s `seq <= lastSeq` guard,
  // because the RETIRING session already pushed `lastSeq` past those values
  // — even though the two sessions' seq counters are entirely independent.
  it('a resumed session whose seed seqs are LOWER than the retiring session\'s high-water mark still renders (store.reset() ran first)', async () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    const firstSession = new FakeSession('first-session', [], 0)
    const secondSeed = [fixtures.turnStart(0), fixtures.userMessage('resumed-with-low-seq', 1)]
    const secondSession = new FakeSession('second-session', secondSeed, 2)
    const { agents, agentCtxCalls } = fakeAgents({ create: firstSession, resume: secondSession })
    const ctx = fakeCtx({ agents })

    const firstDriver = await ZealDriver.start(ctx, store, {})
    // Drive the RETIRING session's `lastSeq` up well past the resumed
    // session's whole seed range — this is the exact high-water mark that,
    // pre-fix, would make the reused store silently drop the resumed
    // session's seq-0/seq-1 seed as "stale replay".
    const firstAgentCtx = agentCtxCalls[0]!
    firstAgentCtx.fire('session/event', {}, fixtures.turnStart(5))
    expect(store.getState().status.running).toBe(true) // sanity: lastSeq is now 5

    await resumeDriver(ctx, store, firstDriver, 'second-session', () => {})

    const settled = store.getState().settled
    const userEntries = settled.filter((e) => e.kind === 'user')
    expect(userEntries).toHaveLength(1)
    expect(userEntries[0]).toMatchObject({ text: 'resumed-with-low-seq' })
  })

  it('rejects any interaction still queued against the retiring session (ZealStoreResetError, not a hang)', async () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    const firstSession = new FakeSession('first-session', [], 0)
    const secondSession = new FakeSession('second-session', [], 0)
    const { agents } = fakeAgents({ create: firstSession, resume: secondSession })
    const ctx = fakeCtx({ agents })

    const firstDriver = await ZealDriver.start(ctx, store, {})
    const stalePrompt = store.askApproval({ title: 'stale approval', detail: '', agentLabel: 'main' })

    await resumeDriver(ctx, store, firstDriver, 'second-session', () => {})

    await expect(stalePrompt).rejects.toThrow('ZealStore was reset')
    expect(store.getState().interaction).toBeUndefined()
  })
})
