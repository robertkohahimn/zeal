/**
 * TDD coverage for Task 13: `registerZealAnswerers` (the global
 * `'approval/request'` waterfall listener + `ctx.userQuestions` provider)
 * and its two pure, separately-exported mappers (`mapQuestions`/
 * `mapAnswers`).
 *
 * Registration wiring is exercised against a hand-rolled `FakeCtx`
 * implementing only the consumed surface (`on`, `userQuestions.
 * registerProvider`) — never a real cordis `Context` — matching the
 * `FakeAgentCtx` pattern already used in `driver.test.ts`. The fake records
 * the registered listener/provider so tests can invoke them directly and
 * assert the decision/answer flows through `ZealStore`'s real interaction
 * queue (Task 6) end to end.
 * @module @zealagent/dsh-zeal/tests/answerers
 */

import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type { AskUserQuestionRequest, UserQuestionProvider } from '@deepseek-ai/dsh-user-questions'
import { mapAnswers, mapQuestions, registerZealAnswerers } from '../src/tui/answerers.ts'
import type { QuestionAnswer, QuestionItem, QuestionsPrompt } from '../src/tui/model.ts'
import { ZealStore } from '../src/tui/store.ts'

/** The exact `'approval/request'` waterfall listener signature (dsh-user-approval index.d.ts:24). */
type ApprovalListener = (req: ApprovalRequest, next: () => Promise<ApprovalOutcome>) => Promise<ApprovalOutcome>

/** A stub `next()` a real waterfall dispatch would supply — Zeal's listener must never call it (see answerers.ts module doc), but the call signature requires one. */
const stubNext = (): Promise<ApprovalOutcome> => Promise.resolve('unavailable')

/** Fake ctx exposing only the surfaces `registerZealAnswerers` consumes: `on`, `userQuestions.registerProvider`, and `effect` (the fiber tie-down for the provider's disposer). */
class FakeCtx {
  readonly onCalls: string[] = []
  approvalListener?: ApprovalListener
  questionProvider?: UserQuestionProvider | undefined
  readonly effectDisposers: Array<() => unknown> = []

  on(name: string, listener: (...args: never[]) => unknown): () => boolean {
    this.onCalls.push(name)
    if (name === 'approval/request') this.approvalListener = listener as ApprovalListener
    return () => true
  }

  effect(execute: () => () => unknown, _label?: string): void {
    this.effectDisposers.push(execute())
  }

  readonly userQuestions = {
    registerProvider: (provider: UserQuestionProvider): (() => void) => {
      this.questionProvider = provider
      return () => {
        if (this.questionProvider === provider) this.questionProvider = undefined
      }
    },
  }
}

/** Minimal fake `Agent` — `answerers.ts` only ever reads `.id`. */
function fakeAgent(id: string): Agent {
  return { id } as unknown as Agent
}

describe('mapQuestions', () => {
  it('maps a bare question: options default to [], multiSelect defaults to false, planReview false without an intent', () => {
    const request: AskUserQuestionRequest = { questions: [{ id: 'q1', question: 'Pick one' }] }
    expect(mapQuestions(request)).toEqual([
      { id: 'q1', question: 'Pick one', options: [], multiSelect: false, planReview: false },
    ])
  })

  it('carries detail/header/options/multiSelect through when present', () => {
    const request: AskUserQuestionRequest = {
      questions: [{
        id: 'q1',
        question: 'Pick',
        detail: 'more context',
        header: 'Section',
        options: [{ label: 'A', description: 'first' }, { label: 'B' }],
        multiSelect: true,
      }],
    }
    expect(mapQuestions(request)).toEqual([{
      id: 'q1',
      question: 'Pick',
      detail: 'more context',
      header: 'Section',
      options: [{ label: 'A', description: 'first' }, { label: 'B' }],
      multiSelect: true,
      planReview: false,
    }])
  })

  it('sets planReview true when intent.kind is plan-review, and does not leak the raw intent object onto the mapped item', () => {
    const request: AskUserQuestionRequest = {
      questions: [{
        id: 'plan',
        question: 'Approve this plan?',
        detail: '1. do x\n2. do y',
        options: [{ label: 'Approve plan' }, { label: 'Request changes' }],
        intent: { kind: 'plan-review', approve: 'Approve plan' },
      }],
    }
    const [item] = mapQuestions(request)
    expect(item?.planReview).toBe(true)
    expect(item).not.toHaveProperty('intent')
  })

  it('plan-review: leaves an already-first approve option untouched', () => {
    const request: AskUserQuestionRequest = {
      questions: [{
        id: 'plan',
        question: 'Approve?',
        detail: 'plan text',
        options: [{ label: 'Approve plan' }, { label: 'Request changes' }],
        intent: { kind: 'plan-review', approve: 'Approve plan' },
      }],
    }
    const [item] = mapQuestions(request)
    expect(item?.options.map(o => o.label)).toEqual(['Approve plan', 'Request changes'])
  })

  it('plan-review: reorders so the intent.approve-labeled option lands at index 0, preserving the relative order of the rest', () => {
    const request: AskUserQuestionRequest = {
      questions: [{
        id: 'plan',
        question: 'Approve?',
        detail: 'plan text',
        options: [{ label: 'Request changes' }, { label: 'Also decline' }, { label: 'Approve plan' }],
        intent: { kind: 'plan-review', approve: 'Approve plan' },
      }],
    }
    const [item] = mapQuestions(request)
    expect(item?.options.map(o => o.label)).toEqual(['Approve plan', 'Request changes', 'Also decline'])
  })

  it('maps multiple questions in one request independently', () => {
    const request: AskUserQuestionRequest = {
      questions: [
        { id: 'q1', question: 'First' },
        { id: 'q2', question: 'Second', options: [{ label: 'X' }], multiSelect: true },
      ],
    }
    expect(mapQuestions(request)).toEqual([
      { id: 'q1', question: 'First', options: [], multiSelect: false, planReview: false },
      { id: 'q2', question: 'Second', options: [{ label: 'X' }], multiSelect: true, planReview: false },
    ])
  })
})

describe('mapAnswers', () => {
  const items: QuestionItem[] = [
    { id: 'q1', question: 'Q1', options: [], multiSelect: false, planReview: false },
    { id: 'q2', question: 'Q2', options: [], multiSelect: false, planReview: false },
  ]

  it('round-trips id/selected/custom verbatim for a matching answer', () => {
    const answers: QuestionAnswer[] = [
      { id: 'q1', selected: ['A'], custom: 'other text' },
      { id: 'q2', selected: ['B', 'C'] },
    ]
    expect(mapAnswers(items, answers)).toEqual({
      answers: [
        { id: 'q1', selected: ['A'], custom: 'other text' },
        { id: 'q2', selected: ['B', 'C'] },
      ],
    })
  })

  it('omits the custom key entirely (not custom: undefined) when the store answer has none', () => {
    const answers: QuestionAnswer[] = [{ id: 'q1', selected: ['A'] }, { id: 'q2', selected: [] }]
    const result = mapAnswers([items[0]!], answers)
    expect(Object.hasOwn(result.answers[0]!, 'custom')).toBe(false)
  })

  it('defaults a missing answer to {id, selected: []}, walking items so order/completeness is guaranteed', () => {
    const answers: QuestionAnswer[] = [{ id: 'q2', selected: ['only q2 answered'] }]
    expect(mapAnswers(items, answers)).toEqual({
      answers: [
        { id: 'q1', selected: [] },
        { id: 'q2', selected: ['only q2 answered'] },
      ],
    })
  })
})

describe('registerZealAnswerers', () => {
  function setup(): { store: ZealStore; ctx: FakeCtx } {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    const ctx = new FakeCtx()
    registerZealAnswerers(ctx as unknown as Context, store)
    return { store, ctx }
  }

  it('registers exactly one global "approval/request" listener and one question provider', () => {
    const { ctx } = setup()
    expect(ctx.onCalls).toEqual(['approval/request'])
    expect(ctx.questionProvider).toBeDefined()
  })

  it('ties the provider\'s unregister disposer to the fiber via ctx.effect, so a disposed zeal-tui mount unregisters it', () => {
    const { ctx } = setup()
    expect(ctx.effectDisposers).toHaveLength(1)
    ctx.effectDisposers[0]()
    expect(ctx.questionProvider).toBeUndefined()
  })

  it('approval: an "allow-once" store decision flows through to the waterfall listener resolving "allowed-once"', async () => {
    const { store, ctx } = setup()
    const req: ApprovalRequest = { agent: fakeAgent('agent-1'), toolName: 'bash', reason: 'run the build' }

    const pending = ctx.approvalListener!(req, stubNext)

    const interaction = store.getState().interaction
    expect(interaction?.kind).toBe('approval')
    if (interaction?.kind !== 'approval') throw new Error('expected an approval interaction')
    expect(interaction.title).toContain('bash')
    expect(interaction.detail).toBe('run the build')
    expect(interaction.agentLabel).toBe('agent-1')

    store.resolveInteraction(interaction.id, 'allow-once')
    await expect(pending).resolves.toBe('allowed-once')
  })

  it('approval: a "reject" store decision flows through to "rejected"', async () => {
    const { store, ctx } = setup()
    const req: ApprovalRequest = { agent: fakeAgent('agent-1'), toolName: 'edit_file' }

    const pending = ctx.approvalListener!(req, stubNext)
    const interaction = store.getState().interaction
    if (interaction?.kind !== 'approval') throw new Error('expected an approval interaction')

    store.resolveInteraction(interaction.id, 'reject')
    await expect(pending).resolves.toBe('rejected')
  })

  it('approval: an empty reason maps to an empty detail (no "undefined" leaking through)', async () => {
    const { store, ctx } = setup()
    const req: ApprovalRequest = { agent: fakeAgent('agent-1'), toolName: 'bash' }

    ctx.approvalListener!(req, stubNext)
    const interaction = store.getState().interaction
    if (interaction?.kind !== 'approval') throw new Error('expected an approval interaction')
    expect(interaction.detail).toBe('')

    store.resolveInteraction(interaction.id, 'reject')
  })

  it('approval: aborting the request signal resolves the listener with "cancelled" (not "unavailable")', async () => {
    const { ctx } = setup()
    const controller = new AbortController()
    const req: ApprovalRequest = { agent: fakeAgent('agent-1'), toolName: 'bash', signal: controller.signal }

    const pending = ctx.approvalListener!(req, stubNext)
    controller.abort(new Error('user cancelled'))

    await expect(pending).resolves.toBe('cancelled')
  })

  it('approval: a store rejection while the request signal is present but NOT aborted propagates unmapped (not mislabeled "cancelled")', async () => {
    // A hand-rolled fake store — the real ZealStore can only reject
    // askApproval via this exact request's own abort (store.ts has no
    // other reject path today), so exercising "some other rejection cause"
    // needs a fake that can reject for an unrelated reason.
    const failure = new Error('boom: unrelated store failure')
    const fakeStore = { askApproval: () => Promise.reject(failure) } as unknown as ZealStore
    const ctx = new FakeCtx()
    registerZealAnswerers(ctx as unknown as Context, fakeStore)

    const controller = new AbortController() // present, but never aborted
    const req: ApprovalRequest = { agent: fakeAgent('agent-1'), toolName: 'bash', signal: controller.signal }

    // The real seam's own waterfall catch-all would map an uncaught
    // rejection here to 'unavailable' (lib/index.js:189) — this test
    // observes the rejection directly at the fake-ctx boundary, which is
    // sufficient to prove the listener does NOT swallow it into 'cancelled'.
    await expect(ctx.approvalListener!(req, stubNext)).rejects.toBe(failure)
  })

  it('approval: a store rejection with no request signal at all also propagates unmapped', async () => {
    const failure = new Error('boom: unrelated store failure')
    const fakeStore = { askApproval: () => Promise.reject(failure) } as unknown as ZealStore
    const ctx = new FakeCtx()
    registerZealAnswerers(ctx as unknown as Context, fakeStore)

    const req: ApprovalRequest = { agent: fakeAgent('agent-1'), toolName: 'bash' }

    await expect(ctx.approvalListener!(req, stubNext)).rejects.toBe(failure)
  })

  it('questions: request.questions is mapped via mapQuestions into the queued QuestionsPrompt, and the resolved answers are mapped back via mapAnswers', async () => {
    const { store, ctx } = setup()
    const request: AskUserQuestionRequest = {
      questions: [{ id: 'q1', question: 'Proceed?', options: [{ label: 'Yes' }, { label: 'No' }] }],
    }

    const pending = ctx.questionProvider!.ask(request)

    const interaction = store.getState().interaction as QuestionsPrompt
    expect(interaction.kind).toBe('questions')
    expect(interaction.items).toEqual(mapQuestions(request))

    store.resolveInteraction(interaction.id, [{ id: 'q1', selected: ['Yes'] }])
    await expect(pending).resolves.toEqual({ answers: [{ id: 'q1', selected: ['Yes'] }] })
  })

  it('questions: honors request.signal by aborting the underlying store request — ask() rejects rather than hanging', async () => {
    const { ctx } = setup()
    const controller = new AbortController()
    const request: AskUserQuestionRequest = {
      questions: [{ id: 'q1', question: 'Proceed?' }],
      signal: controller.signal,
    }

    const pending = ctx.questionProvider!.ask(request)
    controller.abort(new Error('user cancelled'))

    await expect(pending).rejects.toThrow('user cancelled')
  })

  it('questions: a plan-review intent lands the approve-labeled option at index 0 all the way through the queued prompt (binding carried forward from Task 9)', () => {
    const { store, ctx } = setup()
    const request: AskUserQuestionRequest = {
      questions: [{
        id: 'plan',
        question: 'Approve this plan?',
        detail: '1. step one\n2. step two',
        options: [{ label: 'Request changes' }, { label: 'Approve plan' }],
        intent: { kind: 'plan-review', approve: 'Approve plan' },
      }],
    }

    ctx.questionProvider!.ask(request)

    const interaction = store.getState().interaction as QuestionsPrompt
    expect(interaction.items[0]?.planReview).toBe(true)
    expect(interaction.items[0]?.options[0]?.label).toBe('Approve plan')
  })
})
