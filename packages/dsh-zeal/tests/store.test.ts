import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { ZealStore } from '../src/tui/store.ts'
import { eventSequence } from './fixtures/arbitraries.ts'
import { fixtures } from './fixtures/events.ts'

describe('ZealStore fold semantics', () => {
  it('turn-start opens a live turn and marks status running', () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    store.apply(fixtures.turnStart(1))
    const state = store.getState()
    expect(state.live).toEqual({ text: '', reasoning: '', tools: [] })
    expect(state.status.running).toBe(true)
  })

  it('text-delta appends to live.text', () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    store.apply(fixtures.turnStart(1))
    store.apply(fixtures.textChunk('ab', 2))
    store.apply(fixtures.textChunk('cd', 3))
    expect(store.getState().live?.text).toBe('abcd')
  })

  it('reasoning-delta appends to live.reasoning', () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    store.apply(fixtures.turnStart(1))
    store.apply(fixtures.reasoningChunk('hm', 2))
    store.apply(fixtures.reasoningChunk('m...', 3))
    expect(store.getState().live?.reasoning).toBe('hmm...')
  })

  it('tool-call adds a running ToolEntry to live.tools', () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    store.apply(fixtures.turnStart(1))
    store.apply(fixtures.toolCall('call_1', 'bash', '{"cmd":"ls"}', 2))
    expect(store.getState().live?.tools).toEqual([
      { kind: 'tool', seq: 2, callId: 'call_1', name: 'bash', args: '{"cmd":"ls"}', status: 'running', preview: '' },
    ])
  })

  it('tool-result settles the matching tool into settled with ok/error status and preview, removing it from live.tools', () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    store.apply(fixtures.turnStart(1))
    store.apply(fixtures.toolCall('call_1', 'bash', '{"cmd":"ls"}', 2))
    store.apply(fixtures.toolResult('call_1', false, 'file1\nfile2', 3))
    let state = store.getState()
    expect(state.live?.tools).toEqual([])
    expect(state.settled).toEqual([
      { kind: 'tool', seq: 3, callId: 'call_1', name: 'bash', args: '{"cmd":"ls"}', status: 'ok', preview: 'file1\nfile2' },
    ])

    store.apply(fixtures.toolCall('call_2', 'edit', '{}', 4))
    store.apply(fixtures.toolResult('call_2', true, 'boom', 5))
    state = store.getState()
    expect(state.settled[1]).toEqual({ kind: 'tool', seq: 5, callId: 'call_2', name: 'edit', args: '{}', status: 'error', preview: 'boom' })
  })

  it('assistant-message settles an AssistantEntry with the full text and resets live text/reasoning', () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    store.apply(fixtures.turnStart(1))
    store.apply(fixtures.textChunk('partial', 2))
    store.apply(fixtures.reasoningChunk('thinking', 3))
    store.apply(fixtures.assistantMessage('final answer', 'final reasoning', 4))
    const state = store.getState()
    expect(state.settled).toEqual([{ kind: 'assistant', seq: 4, text: 'final answer', reasoning: 'final reasoning' }])
    expect(state.live).toEqual({ text: '', reasoning: '', tools: [] })
  })

  it('user-message settles a UserEntry', () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    store.apply(fixtures.userMessage('hello there', 1))
    expect(store.getState().settled).toEqual([{ kind: 'user', seq: 1, text: 'hello there' }])
  })

  it('turn-end settles still-running live tools and remaining live text, then clears live and stops running', () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    store.apply(fixtures.turnStart(1))
    store.apply(fixtures.toolCall('call_1', 'bash', '{}', 2))
    store.apply(fixtures.textChunk('trailing', 3))
    store.apply(fixtures.turnEnd('completed', 4))
    const state = store.getState()
    expect(state.live).toBeUndefined()
    expect(state.status.running).toBe(false)
    expect(state.settled).toEqual([
      { kind: 'tool', seq: 4, callId: 'call_1', name: 'bash', args: '{}', status: 'running', preview: '' },
      { kind: 'assistant', seq: 4, text: 'trailing', reasoning: '' },
    ])
  })

  it('turn-end does not settle leftover live text when it is empty', () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    store.apply(fixtures.turnStart(1))
    store.apply(fixtures.turnEnd('completed', 2))
    expect(store.getState().settled).toEqual([])
  })

  it('turn-end settles trailing reasoning-only live content, not just text (Finding 1 regression)', () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    store.apply(fixtures.turnStart(1))
    store.apply(fixtures.reasoningChunk('still thinking', 2))
    store.apply(fixtures.turnEnd('aborted', 3))
    expect(store.getState().settled).toEqual([
      { kind: 'assistant', seq: 3, text: '', reasoning: 'still thinking' },
      { kind: 'notice', seq: 3, level: 'info', text: 'turn interrupted' },
    ])
  })

  it('turn-end with an error outcome adds a NoticeEntry carrying the error message', () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    store.apply(fixtures.turnStart(1))
    store.apply(fixtures.turnEndError('RATE_LIMIT', 'too many requests', 2))
    expect(store.getState().settled).toEqual([{ kind: 'notice', seq: 2, level: 'error', text: 'too many requests' }])
  })

  it('turn-end with an aborted outcome adds an info notice', () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    store.apply(fixtures.turnStart(1))
    store.apply(fixtures.turnEnd('aborted', 2))
    expect(store.getState().settled).toEqual([{ kind: 'notice', seq: 2, level: 'info', text: 'turn interrupted' }])
  })

  it('request-header updates status provider and model', () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    store.apply(fixtures.requestHeader('zai', 'glm-5.2-turbo', 1))
    const state = store.getState()
    expect(state.status.provider).toBe('zai')
    expect(state.status.model).toBe('glm-5.2-turbo')
  })

  it('drops events with seq <= lastSeq (idempotent resume replay)', () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    store.apply(fixtures.turnStart(1))
    store.apply(fixtures.textChunk('a', 2))
    const snapshot = store.getState()
    store.apply(fixtures.textChunk('a', 2)) // exact duplicate seq
    store.apply(fixtures.reasoningChunk('x', 1)) // lower seq
    expect(store.getState()).toEqual(snapshot)
  })

  it('(CRITICAL-1) does not drop a seq-0 event on a fresh store (session seqs start at 0)', () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    store.apply(fixtures.turnStart(0))
    expect(store.getState().live).toEqual({ text: '', reasoning: '', tools: [] })
    expect(store.getState().status.running).toBe(true)
    // A second, later event still folds normally after the seq-0 event landed.
    store.apply(fixtures.textChunk('hi', 1))
    expect(store.getState().live?.text).toBe('hi')
  })
})

describe('ZealStore fold interleavings (review findings)', () => {
  it('a tool-result with no matching call is a safe no-op, settled unchanged', () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    store.apply(fixtures.turnStart(1))
    store.apply(fixtures.toolResult('unknown_call', false, 'ignored', 2))
    const state = store.getState()
    expect(state.settled).toEqual([])
    expect(state.live).toEqual({ text: '', reasoning: '', tools: [] })
  })

  it('deltas, tool-call, and tool-result arriving before any turn-start are no-ops', () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    store.apply(fixtures.textChunk('a', 1))
    store.apply(fixtures.reasoningChunk('b', 2))
    store.apply(fixtures.toolCall('call_1', 'bash', '{}', 3))
    store.apply(fixtures.toolResult('call_1', false, 'out', 4))
    const state = store.getState()
    expect(state.live).toBeUndefined()
    expect(state.settled).toEqual([])
  })

  it('assistant-message mid-turn leaves still-running tools untouched in live.tools', () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    store.apply(fixtures.turnStart(1))
    store.apply(fixtures.toolCall('call_1', 'bash', '{}', 2))
    store.apply(fixtures.assistantMessage('interim', 'thinking', 3))
    const state = store.getState()
    expect(state.live?.tools).toEqual([
      { kind: 'tool', seq: 2, callId: 'call_1', name: 'bash', args: '{}', status: 'running', preview: '' },
    ])
    expect(state.settled).toEqual([{ kind: 'assistant', seq: 3, text: 'interim', reasoning: 'thinking' }])
  })

  it('resolving one of two concurrently running tools leaves the sibling running in live.tools', () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    store.apply(fixtures.turnStart(1))
    store.apply(fixtures.toolCall('call_1', 'bash', '{}', 2))
    store.apply(fixtures.toolCall('call_2', 'edit', '{}', 3))
    store.apply(fixtures.toolResult('call_1', false, 'done', 4))
    const state = store.getState()
    expect(state.live?.tools).toEqual([
      { kind: 'tool', seq: 3, callId: 'call_2', name: 'edit', args: '{}', status: 'running', preview: '' },
    ])
    expect(state.settled).toEqual([
      { kind: 'tool', seq: 4, callId: 'call_1', name: 'bash', args: '{}', status: 'ok', preview: 'done' },
    ])
  })
})

describe('ZealStore public API', () => {
  it('addNotice appends a NoticeEntry to settled', () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    store.addNotice('info', 'connected')
    expect(store.getState().settled).toEqual([{ kind: 'notice', seq: 0, level: 'info', text: 'connected' }])
  })

  it('setStatus merges a partial patch into status', () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    store.setStatus({ title: 'building', contextFill: 0.42 })
    expect(store.getState().status).toEqual({
      provider: 'zai',
      model: 'glm-5.2',
      running: false,
      title: 'building',
      contextFill: 0.42,
    })
  })

  it('coalesces subscribe notifications within ~16ms and stops after unsubscribe', async () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    let calls = 0
    const unsubscribe = store.subscribe(() => { calls++ })

    store.apply(fixtures.turnStart(1))
    store.apply(fixtures.textChunk('a', 2))
    store.apply(fixtures.textChunk('b', 3))
    expect(calls).toBe(0)

    await new Promise(resolve => setTimeout(resolve, 30))
    expect(calls).toBe(1)

    unsubscribe()
    store.apply(fixtures.textChunk('c', 4))
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(calls).toBe(1)
  })
})

describe('ZealStore fold properties', () => {
  it('re-applying any prefix is a no-op (idempotence under replay)', () => {
    fc.assert(fc.property(eventSequence(), (events) => {
      const a = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
      for (const e of events) a.apply(e)
      const before = JSON.stringify(a.getState())
      for (const e of events) a.apply(e) // full replay: all seqs stale
      expect(JSON.stringify(a.getState())).toBe(before)
    }))
  })

  it('settled entries only grow, in seq order', () => {
    fc.assert(fc.property(eventSequence(), (events) => {
      const s = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
      let prev = 0
      for (const e of events) {
        s.apply(e)
        const n = s.getState().settled.length
        expect(n).toBeGreaterThanOrEqual(prev)
        prev = n
      }
      const seqs = s.getState().settled.map(x => x.seq)
      expect([...seqs].sort((x, y) => x - y)).toEqual(seqs)
    }))
  })
})
