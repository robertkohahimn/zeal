import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { Transcript } from '../../src/tui/ui/Transcript.tsx'
import type { StatusModel, ZealViewState } from '../../src/tui/model.ts'

const status: StatusModel = { provider: 'zai', model: 'glm-4.6', running: false }

describe('Transcript', () => {
  // (a) a settled user + assistant pair appears in order.
  it('renders a settled user + assistant pair in order', () => {
    const state: ZealViewState = {
      settled: [
        { kind: 'user', seq: 1, text: 'Hello there' },
        { kind: 'assistant', seq: 2, text: 'Hi! How can I help?', reasoning: '' },
      ],
      status,
    }
    const { lastFrame } = render(<Transcript state={state} width={80} />)
    const frame = lastFrame()!
    const userIndex = frame.indexOf('Hello there')
    const assistantIndex = frame.indexOf('Hi! How can I help?')
    expect(userIndex).toBeGreaterThanOrEqual(0)
    expect(assistantIndex).toBeGreaterThan(userIndex)
  })

  // (b) a running tool shows `…` and its name.
  it('shows a spinner glyph and the tool name for a running tool', () => {
    const state: ZealViewState = {
      settled: [],
      live: {
        text: '',
        reasoning: '',
        tools: [{ kind: 'tool', seq: 1, callId: 'c1', name: 'bash', args: '{"cmd":"ls"}', status: 'running', preview: '' }],
      },
      status,
    }
    const { lastFrame } = render(<Transcript state={state} width={80} />)
    const frame = lastFrame()!
    expect(frame).toContain('bash')
    expect(frame).toContain('…')
  })

  // (c) a settled error tool shows its preview lines (capped at 6).
  it('shows up to 6 preview lines for a settled error tool', () => {
    const previewLines = Array.from({ length: 8 }, (_, i) => `line ${i + 1}`)
    const state: ZealViewState = {
      settled: [
        {
          kind: 'tool',
          seq: 1,
          callId: 'c1',
          name: 'bash',
          args: '{"cmd":"boom"}',
          status: 'error',
          preview: previewLines.join('\n'),
        },
      ],
      status,
    }
    const { lastFrame } = render(<Transcript state={state} width={80} />)
    const frame = lastFrame()!
    for (let i = 1; i <= 6; i++) expect(frame).toContain(`line ${i}`)
    expect(frame).not.toContain('line 7')
    expect(frame).not.toContain('line 8')
  })

  // caps at 2 preview lines for a settled ok tool.
  it('shows up to 2 preview lines for a settled ok tool', () => {
    const previewLines = Array.from({ length: 4 }, (_, i) => `out ${i + 1}`)
    const state: ZealViewState = {
      settled: [
        {
          kind: 'tool',
          seq: 1,
          callId: 'c1',
          name: 'read_file',
          args: '{"path":"a.ts"}',
          status: 'ok',
          preview: previewLines.join('\n'),
        },
      ],
      status,
    }
    const { lastFrame } = render(<Transcript state={state} width={80} />)
    const frame = lastFrame()!
    expect(frame).toContain('out 1')
    expect(frame).toContain('out 2')
    expect(frame).not.toContain('out 3')
    expect(frame).not.toContain('out 4')
  })

  // (d) a `subagent` tool renders indented preview (nested child block).
  it('renders a subagent tool preview indented as a nested child block', () => {
    const state: ZealViewState = {
      settled: [
        {
          kind: 'tool',
          seq: 1,
          callId: 'c1',
          name: 'subagent',
          args: '{"task":"investigate"}',
          status: 'ok',
          preview: 'child did X\nchild did Y',
        },
        {
          kind: 'tool',
          seq: 2,
          callId: 'c2',
          name: 'read_file',
          args: '{"path":"a.ts"}',
          status: 'ok',
          preview: 'plain preview line',
        },
      ],
      status,
    }
    const { lastFrame } = render(<Transcript state={state} width={80} />)
    const lines = lastFrame()!.split('\n')
    const nestedLine = lines.find((line) => line.includes('child did X'))!
    const plainLine = lines.find((line) => line.includes('plain preview line'))!
    expect(nestedLine).toBeDefined()
    expect(plainLine).toBeDefined()
    const nestedIndent = nestedLine.length - nestedLine.trimStart().length
    const plainIndent = plainLine.length - plainLine.trimStart().length
    expect(nestedIndent).toBeGreaterThan(plainIndent)
  })

  it('also indents subagent_fork tool previews', () => {
    const state: ZealViewState = {
      settled: [
        {
          kind: 'tool',
          seq: 1,
          callId: 'c1',
          name: 'subagent_fork',
          args: '{}',
          status: 'error',
          preview: 'forked child failed',
        },
      ],
      status,
    }
    const { lastFrame } = render(<Transcript state={state} width={80} />)
    const lines = lastFrame()!.split('\n')
    const nestedLine = lines.find((line) => line.includes('forked child failed'))!
    expect(nestedLine).toBeDefined()
    expect(nestedLine.startsWith(' ')).toBe(true)
  })

  // (e) live reasoning renders before live text.
  it('renders live reasoning above live text', () => {
    const state: ZealViewState = {
      settled: [],
      live: { text: 'Final streaming answer', reasoning: 'thinking it through', tools: [] },
      status,
    }
    const { lastFrame } = render(<Transcript state={state} width={80} />)
    const frame = lastFrame()!
    const reasoningIndex = frame.indexOf('thinking it through')
    const textIndex = frame.indexOf('Final streaming answer')
    expect(reasoningIndex).toBeGreaterThanOrEqual(0)
    expect(textIndex).toBeGreaterThan(reasoningIndex)
  })

  // Review finding 1: store.ts's turn-end fold can settle several entries in
  // the same flush (orphaned running tools + the trailing assistant entry +
  // an error/abort notice), stamping all of them with the same `seq`. A bare
  // `key={entry.seq}` on the Static child collides across kinds and trips
  // React's duplicate-key warning. Reproduce that exact shape and assert all
  // three entries still render, with no duplicate-key warning fired.
  it('renders settled entries that share the same seq without a duplicate-key warning', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const state: ZealViewState = {
        settled: [
          { kind: 'tool', seq: 5, callId: 'c1', name: 'bash', args: '{}', status: 'error', preview: 'boom' },
          { kind: 'assistant', seq: 5, text: 'trailing assistant text', reasoning: '' },
          { kind: 'notice', seq: 5, level: 'error', text: 'turn aborted' },
        ],
        status,
      }
      const { lastFrame } = render(<Transcript state={state} width={80} />)
      const frame = lastFrame()!
      expect(frame).toContain('boom')
      expect(frame).toContain('trailing assistant text')
      expect(frame).toContain('turn aborted')

      const duplicateKeyWarningFired = consoleErrorSpy.mock.calls.some((call) =>
        call.some((arg) => typeof arg === 'string' && arg.includes('same key')),
      )
      expect(duplicateKeyWarningFired).toBe(false)
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  // Review finding 2: every other test in this file renders once with final
  // state, which can't catch a regression of <Static>'s append semantics
  // (already-flushed settled items must not re-render/duplicate as new
  // settled items and a new live turn arrive). Exercise a real rerender: 1
  // settled entry + a live turn, then the live content settles as entry 2
  // alongside a fresh live turn — assert both settled entries appear exactly
  // once each, in order, and the new live text also appears.
  it('appends settled entries across a rerender without duplicating already-flushed ones', () => {
    const state1: ZealViewState = {
      settled: [{ kind: 'user', seq: 1, text: 'First settled message' }],
      live: { text: 'partial streaming answer', reasoning: '', tools: [] },
      status,
    }
    const { lastFrame, rerender } = render(<Transcript state={state1} width={80} />)
    expect(lastFrame()).toContain('First settled message')
    expect(lastFrame()).toContain('partial streaming answer')

    const state2: ZealViewState = {
      settled: [
        { kind: 'user', seq: 1, text: 'First settled message' },
        { kind: 'assistant', seq: 2, text: 'partial streaming answer', reasoning: '' },
      ],
      live: { text: 'next turn starting', reasoning: '', tools: [] },
      status,
    }
    rerender(<Transcript state={state2} width={80} />)
    const frame = lastFrame()!

    const occurrences = (haystack: string, needle: string) => haystack.split(needle).length - 1
    expect(occurrences(frame, 'First settled message')).toBe(1)
    expect(occurrences(frame, 'partial streaming answer')).toBe(1)
    expect(frame).toContain('next turn starting')

    const firstIndex = frame.indexOf('First settled message')
    const secondIndex = frame.indexOf('partial streaming answer')
    const liveIndex = frame.indexOf('next turn starting')
    expect(secondIndex).toBeGreaterThan(firstIndex)
    expect(liveIndex).toBeGreaterThan(secondIndex)
  })
})
