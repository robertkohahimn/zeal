import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
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
})
