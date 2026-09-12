import { describe, expect, it } from 'vitest'
import { ZealStore } from '../src/tui/store.ts'

describe('ZealStore interaction queue', () => {
  it('(a) askApproval surfaces the prompt in state and resolves with the decision passed to resolveInteraction', async () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    const pending = store.askApproval({ title: 'Run rm -rf', detail: 'delete build/', agentLabel: 'main' })

    const interaction = store.getState().interaction
    expect(interaction).toEqual({ kind: 'approval', id: expect.any(Number), title: 'Run rm -rf', detail: 'delete build/', agentLabel: 'main' })

    const id = (interaction as { id: number }).id
    store.resolveInteraction(id, 'allow-once')

    await expect(pending).resolves.toBe('allow-once')
    expect(store.getState().interaction).toBeUndefined()
  })

  it('(b) two concurrent requests are served FIFO', async () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    const first = store.askApproval({ title: 'first', detail: 'd1', agentLabel: 'main' })
    const second = store.askApproval({ title: 'second', detail: 'd2', agentLabel: 'main' })

    const firstId = (store.getState().interaction as { id: number }).id
    expect((store.getState().interaction as { title: string }).title).toBe('first')

    store.resolveInteraction(firstId, 'reject')
    await expect(first).resolves.toBe('reject')

    const secondInteraction = store.getState().interaction
    expect(secondInteraction).toBeDefined()
    expect((secondInteraction as { title: string }).title).toBe('second')

    const secondId = (secondInteraction as { id: number }).id
    expect(secondId).not.toBe(firstId)
    store.resolveInteraction(secondId, 'allow-once')
    await expect(second).resolves.toBe('allow-once')
    expect(store.getState().interaction).toBeUndefined()
  })

  it('(c) aborting a queued (non-head) request removes it without disturbing the head', async () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    const controller = new AbortController()
    const head = store.askApproval({ title: 'head', detail: 'd1', agentLabel: 'main' })
    const queued = store.askApproval({ title: 'queued', detail: 'd2', agentLabel: 'main' }, controller.signal)

    const headId = (store.getState().interaction as { id: number }).id

    const reason = new Error('cancelled')
    controller.abort(reason)
    await expect(queued).rejects.toThrow('cancelled')

    // Head is untouched: still surfaced, still the same id.
    expect((store.getState().interaction as { id: number }).id).toBe(headId)
    expect((store.getState().interaction as { title: string }).title).toBe('head')

    store.resolveInteraction(headId, 'allow-once')
    await expect(head).resolves.toBe('allow-once')
    expect(store.getState().interaction).toBeUndefined()
  })

  it('(d) aborting the head promotes the next', async () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    const controller = new AbortController()
    const head = store.askApproval({ title: 'head', detail: 'd1', agentLabel: 'main' }, controller.signal)
    const next = store.askApproval({ title: 'next', detail: 'd2', agentLabel: 'main' })

    const reason = new Error('user cancelled head')
    controller.abort(reason)
    await expect(head).rejects.toThrow('user cancelled head')

    const interaction = store.getState().interaction
    expect(interaction).toBeDefined()
    expect((interaction as { title: string }).title).toBe('next')

    const nextId = (interaction as { id: number }).id
    store.resolveInteraction(nextId, 'reject')
    await expect(next).resolves.toBe('reject')
    expect(store.getState().interaction).toBeUndefined()
  })

  it('an already-aborted signal rejects immediately and never surfaces in state', async () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    const controller = new AbortController()
    const reason = new Error('pre-aborted')
    controller.abort(reason)

    const pending = store.askApproval({ title: 'never shown', detail: 'd', agentLabel: 'main' }, controller.signal)
    await expect(pending).rejects.toThrow('pre-aborted')
    expect(store.getState().interaction).toBeUndefined()
  })

  it('askQuestions surfaces a questions prompt and resolves with the answers passed to resolveInteraction', async () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    const items = [
      { id: 'q1', question: 'Proceed?', options: [{ label: 'Yes' }, { label: 'No' }], multiSelect: false, planReview: false },
    ]
    const pending = store.askQuestions(items)

    const interaction = store.getState().interaction
    expect(interaction).toEqual({ kind: 'questions', id: expect.any(Number), items })

    const id = (interaction as { id: number }).id
    const answers = [{ id: 'q1', selected: ['Yes'] }]
    store.resolveInteraction(id, answers)

    await expect(pending).resolves.toEqual(answers)
    expect(store.getState().interaction).toBeUndefined()
  })

  it('resolveInteraction with an unknown id is a safe no-op', () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    void store.askApproval({ title: 'head', detail: 'd', agentLabel: 'main' })
    const before = store.getState().interaction
    store.resolveInteraction(999999, 'allow-once')
    expect(store.getState().interaction).toEqual(before)
  })

  it('notifies subscribers when an interaction is enqueued and when it settles', async () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    let calls = 0
    store.subscribe(() => { calls++ })

    const pending = store.askApproval({ title: 'head', detail: 'd', agentLabel: 'main' })
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(calls).toBe(1)

    const id = (store.getState().interaction as { id: number }).id
    store.resolveInteraction(id, 'allow-once')
    await pending
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(calls).toBe(2)
  })
})
