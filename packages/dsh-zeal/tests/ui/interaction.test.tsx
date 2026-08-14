import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { InteractionPanel } from '../../src/tui/ui/InteractionPanel.tsx'
import type { ApprovalDecision, ApprovalPrompt, QuestionAnswer, QuestionsPrompt } from '../../src/tui/model.ts'

/**
 * ink's reconciler schedules commits via `queueMicrotask` (see
 * `reconciler.js`'s `scheduleMicrotask: queueMicrotask`), and `useInput`'s
 * handler is a `useEffectEvent` whose closure only refreshes after a commit.
 * Firing two `stdin.write()` calls back-to-back means the second keystroke
 * is handled before the first one's state update has committed, so it
 * still sees the pre-update closure. Yielding a macrotask between writes
 * (mirroring ink's own internal `yieldImmediate` helper, which also uses
 * `setImmediate`) lets each keystroke's state update land before the next.
 */
async function press(stdin: { write: (data: string) => void }, ...keys: string[]): Promise<void> {
  for (const key of keys) {
    stdin.write(key)
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
}

describe('InteractionPanel — approval', () => {
  const approval: ApprovalPrompt = {
    kind: 'approval',
    id: 1,
    title: 'Run rm -rf build/',
    detail: 'delete build/',
    agentLabel: 'main',
  }

  it('shows title, detail, and the y/n hint', () => {
    const onResolve = vi.fn()
    const { lastFrame } = render(<InteractionPanel interaction={approval} onResolve={onResolve} />)
    const frame = lastFrame()!
    expect(frame).toContain('Run rm -rf build/')
    expect(frame).toContain('delete build/')
    expect(frame).toContain('[y] allow once')
    expect(frame).toContain('[n] reject')
  })

  it('"y" resolves with allow-once', () => {
    const onResolve = vi.fn()
    const { stdin } = render(<InteractionPanel interaction={approval} onResolve={onResolve} />)
    stdin.write('y')
    expect(onResolve).toHaveBeenCalledWith(1, 'allow-once' satisfies ApprovalDecision)
  })

  it('"n" resolves with reject', () => {
    const onResolve = vi.fn()
    const { stdin } = render(<InteractionPanel interaction={approval} onResolve={onResolve} />)
    stdin.write('n')
    expect(onResolve).toHaveBeenCalledWith(1, 'reject' satisfies ApprovalDecision)
  })

  it('ignores unrelated keys', () => {
    const onResolve = vi.fn()
    const { stdin } = render(<InteractionPanel interaction={approval} onResolve={onResolve} />)
    stdin.write('x')
    expect(onResolve).not.toHaveBeenCalled()
  })
})

describe('InteractionPanel — questions', () => {
  it('renders numbered options', () => {
    const prompt: QuestionsPrompt = {
      kind: 'questions',
      id: 2,
      items: [
        {
          id: 'q1',
          question: 'Which approach?',
          options: [{ label: 'Approach A' }, { label: 'Approach B' }],
          multiSelect: false,
          planReview: false,
        },
      ],
    }
    const onResolve = vi.fn()
    const { lastFrame } = render(<InteractionPanel interaction={prompt} onResolve={onResolve} />)
    const frame = lastFrame()!
    expect(frame).toContain('Which approach?')
    expect(frame).toContain('[1]')
    expect(frame).toContain('Approach A')
    expect(frame).toContain('[2]')
    expect(frame).toContain('Approach B')
  })

  it('number key selects, enter submits (single-select)', async () => {
    const prompt: QuestionsPrompt = {
      kind: 'questions',
      id: 2,
      items: [
        {
          id: 'q1',
          question: 'Which approach?',
          options: [{ label: 'Approach A' }, { label: 'Approach B' }],
          multiSelect: false,
          planReview: false,
        },
      ],
    }
    const onResolve = vi.fn()
    const { stdin } = render(<InteractionPanel interaction={prompt} onResolve={onResolve} />)
    await press(stdin, '2', '\r')
    const expected: QuestionAnswer[] = [{ id: 'q1', selected: ['Approach B'] }]
    expect(onResolve).toHaveBeenCalledWith(2, expected)
  })

  it('space toggles the numbered option under multiSelect, enter submits all toggled', async () => {
    const prompt: QuestionsPrompt = {
      kind: 'questions',
      id: 3,
      items: [
        {
          id: 'q1',
          question: 'Pick any',
          options: [{ label: 'One' }, { label: 'Two' }, { label: 'Three' }],
          multiSelect: true,
          planReview: false,
        },
      ],
    }
    const onResolve = vi.fn()
    const { stdin } = render(<InteractionPanel interaction={prompt} onResolve={onResolve} />)
    await press(stdin, '1', ' ', '3', ' ', '\r')
    const expected: QuestionAnswer[] = [{ id: 'q1', selected: ['One', 'Three'] }]
    expect(onResolve).toHaveBeenCalledWith(3, expected)
  })

  it('"c" opens free-text custom answer, typed characters accumulate, enter submits it', async () => {
    const prompt: QuestionsPrompt = {
      kind: 'questions',
      id: 4,
      items: [
        {
          id: 'q1',
          question: 'Anything else?',
          options: [{ label: 'Yes' }, { label: 'No' }],
          multiSelect: false,
          planReview: false,
        },
      ],
    }
    const onResolve = vi.fn()
    const { stdin } = render(<InteractionPanel interaction={prompt} onResolve={onResolve} />)
    await press(stdin, 'c', 'h', 'i', '\r')
    const expected: QuestionAnswer[] = [{ id: 'q1', selected: [], custom: 'hi' }]
    expect(onResolve).toHaveBeenCalledWith(4, expected)
  })

  it('advances through multiple items before resolving', async () => {
    const prompt: QuestionsPrompt = {
      kind: 'questions',
      id: 5,
      items: [
        {
          id: 'q1',
          question: 'First?',
          options: [{ label: 'A' }, { label: 'B' }],
          multiSelect: false,
          planReview: false,
        },
        {
          id: 'q2',
          question: 'Second?',
          options: [{ label: 'C' }, { label: 'D' }],
          multiSelect: false,
          planReview: false,
        },
      ],
    }
    const onResolve = vi.fn()
    const { stdin, lastFrame } = render(<InteractionPanel interaction={prompt} onResolve={onResolve} />)
    await press(stdin, '1', '\r')
    expect(onResolve).not.toHaveBeenCalled()
    expect(lastFrame()!).toContain('Second?')
    await press(stdin, '2', '\r')
    const expected: QuestionAnswer[] = [
      { id: 'q1', selected: ['A'] },
      { id: 'q2', selected: ['D'] },
    ]
    expect(onResolve).toHaveBeenCalledWith(5, expected)
  })
})

describe('InteractionPanel — plan review', () => {
  const planReviewPrompt: QuestionsPrompt = {
    kind: 'questions',
    id: 6,
    items: [
      {
        id: 'plan',
        question: 'Approve this plan?',
        options: [{ label: 'Approve plan' }, { label: 'Request changes' }],
        multiSelect: false,
        planReview: true,
      },
    ],
  }

  it('renders the framed PLAN REVIEW variant with the a/r hint', () => {
    const onResolve = vi.fn()
    const { lastFrame } = render(<InteractionPanel interaction={planReviewPrompt} onResolve={onResolve} />)
    const frame = lastFrame()!
    expect(frame).toContain('PLAN REVIEW')
    expect(frame).toContain('[a] approve plan')
    expect(frame).toContain('[r] request changes')
  })

  it('"a" resolves with the approve option selected', () => {
    const onResolve = vi.fn()
    const { stdin } = render(<InteractionPanel interaction={planReviewPrompt} onResolve={onResolve} />)
    stdin.write('a')
    const expected: QuestionAnswer[] = [{ id: 'plan', selected: ['Approve plan'] }]
    expect(onResolve).toHaveBeenCalledWith(6, expected)
  })

  it('"r" resolves with the remainder option selected', () => {
    const onResolve = vi.fn()
    const { stdin } = render(<InteractionPanel interaction={planReviewPrompt} onResolve={onResolve} />)
    stdin.write('r')
    const expected: QuestionAnswer[] = [{ id: 'plan', selected: ['Request changes'] }]
    expect(onResolve).toHaveBeenCalledWith(6, expected)
  })

  it('falls back to options[0] as approve and the first other option as remainder when labels do not disambiguate', () => {
    const ambiguousPrompt: QuestionsPrompt = {
      kind: 'questions',
      id: 7,
      items: [
        {
          id: 'plan',
          question: 'Approve this plan?',
          options: [{ label: 'Option 1' }, { label: 'Option 2' }],
          multiSelect: false,
          planReview: true,
        },
      ],
    }
    const onResolve = vi.fn()
    const { stdin } = render(<InteractionPanel interaction={ambiguousPrompt} onResolve={onResolve} />)
    stdin.write('a')
    expect(onResolve).toHaveBeenCalledWith(7, [{ id: 'plan', selected: ['Option 1'] }])
  })
})

// Regression coverage for the fix-round-1 review finding: Ink coalesces
// consecutive plain bytes read in one `stdin` chunk into a single multi-char
// `input` string (fast typing, SSH bursts, or a test doing `stdin.write`
// with more than one character at once) — every keyboard branch must walk
// that string character-by-character instead of exact-matching the whole
// chunk, or it silently no-ops and the interaction hangs.
describe('InteractionPanel — coalesced multi-char stdin chunks', () => {
  const approval: ApprovalPrompt = {
    kind: 'approval',
    id: 10,
    title: 'Run rm -rf build/',
    detail: 'delete build/',
    agentLabel: 'main',
  }

  it('approval: a single "yy" chunk resolves exactly once with allow-once', () => {
    const onResolve = vi.fn()
    const { stdin } = render(<InteractionPanel interaction={approval} onResolve={onResolve} />)
    stdin.write('yy')
    expect(onResolve).toHaveBeenCalledTimes(1)
    expect(onResolve).toHaveBeenCalledWith(10, 'allow-once' satisfies ApprovalDecision)
  })

  it('questions: a single "2\\r" chunk selects option 2 and submits', async () => {
    const prompt: QuestionsPrompt = {
      kind: 'questions',
      id: 11,
      items: [
        {
          id: 'q1',
          question: 'Which approach?',
          options: [{ label: 'Approach A' }, { label: 'Approach B' }],
          multiSelect: false,
          planReview: false,
        },
      ],
    }
    const onResolve = vi.fn()
    const { stdin } = render(<InteractionPanel interaction={prompt} onResolve={onResolve} />)
    await press(stdin, '2\r')
    const expected: QuestionAnswer[] = [{ id: 'q1', selected: ['Approach B'] }]
    expect(onResolve).toHaveBeenCalledTimes(1)
    expect(onResolve).toHaveBeenCalledWith(11, expected)
  })

  it('custom mode: a multi-char chunk (paste) appends verbatim, digits/space/"c" included, with no hotkey side effects', async () => {
    const prompt: QuestionsPrompt = {
      kind: 'questions',
      id: 12,
      items: [
        {
          id: 'q1',
          question: 'Anything else?',
          options: [{ label: 'Yes' }, { label: 'No' }],
          multiSelect: false,
          planReview: false,
        },
      ],
    }
    const onResolve = vi.fn()
    const { stdin } = render(<InteractionPanel interaction={prompt} onResolve={onResolve} />)
    await press(stdin, 'c')
    // If this chunk's digits/space/'c' were treated as hotkeys instead of
    // pasted text, they'd move the option cursor, toggle a selection, or
    // (mis-)re-enter custom mode instead of landing in the answer buffer.
    await press(stdin, '42 c')
    await press(stdin, '\r')
    const expected: QuestionAnswer[] = [{ id: 'q1', selected: [], custom: '42 c' }]
    expect(onResolve).toHaveBeenCalledTimes(1)
    expect(onResolve).toHaveBeenCalledWith(12, expected)
  })
})
