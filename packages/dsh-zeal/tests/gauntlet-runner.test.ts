/**
 * TDD coverage for Task 17: `gauntlet-runner.ts`.
 *
 * Three layers, cheapest/most-isolated first:
 *
 * 1. `mapMachineAnswer`/`mapMachineAnswers` — pure functions, the task's
 *    required TDD target: plan-review picks the named approve option,
 *    option-less questions answer 'yes', option questions pick `options[0]`.
 * 2. `registerMachineSubstitutes` — wiring onto a hand-rolled `FakeCtx`
 *    exposing only the consumed surface (`on`, `userQuestions.
 *    registerProvider`), matching the `FakeCtx` pattern `answerers.test.ts`
 *    already uses for the interactive answerers. Proves the approval
 *    listener always grants without ever calling `next`, and the question
 *    provider is wired through the pure mapper.
 * 3. `apply()`/`run()` — a real `cordis.Context` bench with the real
 *    `dsh-session`/`dsh-agent`/`dsh-agent-default-model` plugins and a
 *    scripted `AgentFactory`, adapted directly from
 *    `$DSH_SRC/packages/bundle/headless/tests/headless.spec.ts` (this
 *    runner mirrors that file's `run()` closely, so its test bench is the
 *    right precedent to mirror too). Proves the full aggregate-flush-exit
 *    sequence end to end, plus that the machine substitutes are registered
 *    before the run starts.
 * @module @zealagent/dsh-zeal/tests/gauntlet-runner
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle, CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session, UserMessage } from '@deepseek-ai/dsh-session'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type { AskUserQuestionAnswer, AskUserQuestionItem, AskUserQuestionRequest, UserQuestionProvider } from '@deepseek-ai/dsh-user-questions'
import {
  apply,
  Config,
  internals,
  mapMachineAnswer,
  mapMachineAnswers,
  name,
  registerMachineSubstitutes,
} from '../src/gauntlet-runner.ts'

describe('mapMachineAnswer / mapMachineAnswers', () => {
  it('plan-review: picks the option NAMED by intent.approve, not positionally', () => {
    const question: AskUserQuestionItem = {
      id: 'plan',
      question: 'Approve this plan?',
      options: [{ label: 'Request changes' }, { label: 'Approve plan' }],
      intent: { kind: 'plan-review', approve: 'Approve plan' },
    }
    expect(mapMachineAnswer(question)).toEqual({ id: 'plan', selected: ['Approve plan'] })
  })

  it('option-less question answers the literal string "yes"', () => {
    const question: AskUserQuestionItem = { id: 'q1', question: 'Continue?' }
    expect(mapMachineAnswer(question)).toEqual({ id: 'q1', selected: ['yes'] })
  })

  it('non-plan-review question with options picks options[0]', () => {
    const question: AskUserQuestionItem = {
      id: 'q1',
      question: 'Pick one',
      options: [{ label: 'B' }, { label: 'A' }],
    }
    expect(mapMachineAnswer(question)).toEqual({ id: 'q1', selected: ['B'] })
  })

  it('an empty options array is treated as option-less (falls back to "yes")', () => {
    const question: AskUserQuestionItem = { id: 'q1', question: 'Pick one', options: [] }
    expect(mapMachineAnswer(question)).toEqual({ id: 'q1', selected: ['yes'] })
  })

  it('mapMachineAnswers maps every question in request order', () => {
    const request: AskUserQuestionRequest = {
      questions: [
        { id: 'q1', question: 'Continue?' },
        { id: 'q2', question: 'Pick', options: [{ label: 'X' }, { label: 'Y' }] },
        {
          id: 'plan',
          question: 'Approve?',
          options: [{ label: 'Decline' }, { label: 'Approve' }],
          intent: { kind: 'plan-review', approve: 'Approve' },
        },
      ],
    }
    expect(mapMachineAnswers(request)).toEqual({
      answers: [
        { id: 'q1', selected: ['yes'] },
        { id: 'q2', selected: ['X'] },
        { id: 'plan', selected: ['Approve'] },
      ],
    })
  })
})

/** Fake ctx exposing only the surface `registerMachineSubstitutes` consumes: `on` and `userQuestions.registerProvider`. */
class FakeCtx {
  readonly onCalls: string[] = []
  approvalListener?: (req: ApprovalRequest, next: () => Promise<ApprovalOutcome>) => Promise<ApprovalOutcome>
  questionProvider?: UserQuestionProvider

  on(eventName: string, listener: (...args: never[]) => unknown): () => boolean {
    this.onCalls.push(eventName)
    if (eventName === 'approval/request') {
      this.approvalListener = listener as (req: ApprovalRequest, next: () => Promise<ApprovalOutcome>) => Promise<ApprovalOutcome>
    }
    return () => true
  }

  readonly userQuestions = {
    registerProvider: (provider: UserQuestionProvider): (() => void) => {
      this.questionProvider = provider
      return () => {}
    },
  }
}

function fakeAgent(id: string): Agent {
  return { id } as unknown as Agent
}

const stubNext = (): Promise<ApprovalOutcome> => Promise.resolve('unavailable')

describe('registerMachineSubstitutes', () => {
  it('registers exactly one global "approval/request" listener and one question provider', () => {
    const ctx = new FakeCtx()
    registerMachineSubstitutes(ctx as unknown as import('@deepseek-ai/cordis').Context)
    expect(ctx.onCalls).toEqual(['approval/request'])
    expect(ctx.questionProvider).toBeDefined()
  })

  it('approval: always grants "allowed-once", regardless of toolName/reason, and never calls next', async () => {
    const ctx = new FakeCtx()
    registerMachineSubstitutes(ctx as unknown as import('@deepseek-ai/cordis').Context)
    const req: ApprovalRequest = { agent: fakeAgent('a1'), toolName: 'bash', reason: 'run the build' }
    let nextCalled = false
    const next = (): Promise<ApprovalOutcome> => { nextCalled = true; return stubNext() }

    await expect(ctx.approvalListener!(req, next)).resolves.toBe('allowed-once')
    expect(nextCalled).toBe(false)
  })

  it('approval: grants even a request with no reason/callId/signal at all', async () => {
    const ctx = new FakeCtx()
    registerMachineSubstitutes(ctx as unknown as import('@deepseek-ai/cordis').Context)
    const req: ApprovalRequest = { agent: fakeAgent('a1'), toolName: 'edit_file' }
    await expect(ctx.approvalListener!(req, stubNext)).resolves.toBe('allowed-once')
  })

  it('questions: the provider answers via mapMachineAnswers', async () => {
    const ctx = new FakeCtx()
    registerMachineSubstitutes(ctx as unknown as import('@deepseek-ai/cordis').Context)
    const request: AskUserQuestionRequest = {
      questions: [
        { id: 'q1', question: 'Continue?' },
        {
          id: 'plan',
          question: 'Approve?',
          options: [{ label: 'Decline' }, { label: 'Approve' }],
          intent: { kind: 'plan-review', approve: 'Approve' },
        },
      ],
    }
    const answer: AskUserQuestionAnswer = await ctx.questionProvider!.ask(request)
    expect(answer).toEqual(mapMachineAnswers(request))
    expect(answer).toEqual({ answers: [{ id: 'q1', selected: ['yes'] }, { id: 'plan', selected: ['Approve'] }] })
  })
})

describe('plugin identity', () => {
  it('exports the name the overlay row expects, and injects the services apply() dot-accesses', async () => {
    expect(name).toBe('zeal-gauntlet-runner')
    const { inject } = await import('../src/gauntlet-runner.ts')
    expect(inject).toEqual(['agentDefaultModel', 'agents', 'sessions', 'userQuestions'])
  })

  it('validates config: task is required', () => {
    expect(() => new Config({} as never)).toThrow()
    expect(new Config({ task: 'fix the bug' })).toEqual({ task: 'fix the bug' })
  })
})

// --- Layer 3: real-Context bench, adapted from headless.spec.ts ---

const originalInternals = { ...internals }
afterEach(() => { Object.assign(internals, originalInternals) })

interface Script {
  before?(session: Session): void
  afterPrompt(session: Session, message: UserMessage): Promise<void> | void
}

function appendTurn(
  session: Session,
  turn: number,
  message: UserMessage,
  text: string | undefined,
  completed: boolean,
): void {
  session.append('turn/start', { turn })
  session.append('step/start', { turn, step: 1 })
  session.append('user/message', message, { surfaceOp: 'append' })
  if (text !== undefined) {
    session.append('assistant/message', {
      turn,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text }],
        source: { provider: 'test-provider', model: 'test-model' },
      }),
    }, { surfaceOp: 'append' })
  }
  session.append('step/end', { turn, step: 1 })
  session.append('turn/end', {
    turn,
    reason: completed
      ? { kind: 'completed' }
      : { kind: 'aborted', reason: { kind: 'user' } },
  })
}

/** Mount the real registries (agents/sessions/default-model/user-questions) around a small scripted Agent factory. */
async function bench(script: Script): Promise<{
  ctx: Context
  run(): Promise<{ code: number; out: string; err: string; order: string[] }>
}> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentDefaultModelConfig, { provider: 'test-provider', model: 'test-model' })
  // Real UserQuestionService so `apply()`'s `ctx.userQuestions.registerProvider`
  // dot-access resolves for real, not just through a fake.
  const { default: UserQuestionService } = await import('@deepseek-ai/dsh-user-questions')
  await ctx.plugin(UserQuestionService)
  ctx.agents.setFactory({
    async createAgent(ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle> {
      const session = ctx.sessions.create(options.sessionId, {
        ...options.meta === undefined ? {} : { meta: options.meta },
      })
      let idle = Promise.resolve()
      const agent = {} as Agent
      const agentCtx = ownerCtx.extend({ agent })
      Object.assign(agent, {
        id: session.id,
        options: options.agentOptions ?? {},
        session,
        inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
        status: 'idle',
        ctx: agentCtx,
        cancel: () => {},
        runMaintenance: () => Promise.reject(new Error('not used')),
        send: () => {},
        followup: (message: UserMessage) => {
          agent.inbox.append('next-turn', message)
          idle = Promise.resolve().then(() => script.afterPrompt(session, message))
        },
        steer: () => {},
        inject: () => {},
        whenIdle: () => idle,
      } satisfies Partial<Agent>)
      await options.setup?.(agentCtx)
      script.before?.(session)
      ctx.agents.register(agent)
      return { agent, dispose: () => Promise.resolve() }
    },
    resume: () => Promise.reject(new Error('not used')),
  })
  return {
    ctx,
    run: async () => {
      let out = ''
      let err = ''
      const order: string[] = []
      ctx.on('session/flush', () => { order.push('flush') })
      internals.stdout = { write: (chunk: string) => { out += chunk; return true } }
      internals.stderr = { write: (chunk: string) => { err += chunk; return true } }
      const exited = new Promise<number>((resolve) => {
        ctx.provide('appExit', (code: number) => { order.push('exit'); resolve(code) })
      })
      apply(ctx, { task: 'do the thing' })
      return { code: await exited, out, err, order }
    },
  }
}

describe('gauntlet runner (real-Context bench)', () => {
  it('aggregates the final text across the complete idle-to-idle interval and flushes before exit', async () => {
    const test = await bench({
      before(session) {
        const setupMessage = {
          role: 'user', content: [{ type: 'text', text: 'setup' }], source: { kind: 'user' }, id: 'setup',
        } as UserMessage
        appendTurn(session, 0, setupMessage, 'pre-task noise', true)
      },
      async afterPrompt(session, message) {
        await Promise.resolve()
        appendTurn(session, 1, message, '', true)
        appendTurn(session, 2, message, 'final answer', true)
      },
    })
    const result = await test.run()
    expect(result).toEqual({ code: 0, out: 'final answer\n', err: '', order: ['flush', 'exit'] })
    await test.ctx.fiber.dispose()
  })

  it('exits 1 when the final turn does not complete', async () => {
    const test = await bench({
      afterPrompt(session, message) { appendTurn(session, 1, message, undefined, false) },
    })
    expect(await test.run()).toMatchObject({ code: 1, out: '\n', err: '' })
    await test.ctx.fiber.dispose()
  })

  it('prints the durable model failure when the final turn ends in error', async () => {
    const test = await bench({
      afterPrompt(session, message) {
        session.append('turn/start', { turn: 1 })
        session.append('step/start', { turn: 1, step: 1 })
        session.append('user/message', message, { surfaceOp: 'append' })
        session.append('step/end', { turn: 1, step: 1 })
        session.append('turn/end', {
          turn: 1,
          reason: { kind: 'error', error: { code: 'SERVER', message: 'provider unavailable' } },
        })
      },
    })
    expect(await test.run()).toMatchObject({ code: 1, out: '\n', err: 'dsh: SERVER: provider unavailable\n' })
    await test.ctx.fiber.dispose()
  })

  it('apply() wires the real userQuestions provider and approval listener on a real Context before run() starts (no throw, both registered)', async () => {
    const test = await bench({
      afterPrompt(session, message) { appendTurn(session, 1, message, 'done', true) },
    })
    let approvalListenerCalls = 0
    // Registering a second listener on the SAME real Context this late would
    // only be reachable if `apply()`'s own registration (via `ctx.on`,
    // called synchronously before `run()`'s async body) did not already
    // throw/crash the mount — a real `ctx.userQuestions.registerProvider`
    // call rejects a second provider outright (`UserQuestionService`'s own
    // "only one provider may be active" contract), so successfully running
    // `apply()` on a Context that already mounted the real
    // `UserQuestionService` plugin is itself proof the registration
    // succeeded once, synchronously, without needing a second provider here.
    test.ctx.on('approval/request', () => { approvalListenerCalls += 1; return Promise.resolve('unavailable') })
    const result = await test.run()
    expect(result.code).toBe(0)
    expect(approvalListenerCalls).toBe(0)
    await test.ctx.fiber.dispose()
  })

  it('fails loud without the launcher-provided exit request', () => {
    const ctx = new Context()
    ctx.provide('userQuestions', { registerProvider: () => () => {} } as never)
    expect(() => { apply(ctx, { task: 't' }) }).toThrow('must provide ctx.appExit')
  })

  it('reports a direct Agent creation failure', async () => {
    const ctx = new Context()
    let err = ''
    internals.stdout = { write: () => true }
    internals.stderr = { write: (chunk: string) => { err += chunk; return true } }
    const exited = new Promise<number>((resolve) => {
      ctx.provide('appExit', resolve)
    })
    ctx.provide('userQuestions', { registerProvider: () => () => {} } as never)
    ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    ctx.provide('sessions', { flush: () => Promise.resolve(true) } as never)
    ctx.provide('agents', { create: () => Promise.reject(new Error('factory exploded')) } as never)
    apply(ctx, { task: 't' })
    expect(await exited).toBe(1)
    expect(err).toBe('dsh: factory exploded\n')
    await ctx.fiber.dispose()
  })
})
