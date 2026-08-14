import { describe, expect, it } from 'vitest'
import { editorReduce, emptyEditor, stripPasteMarkers } from '../src/tui/editor.ts'
import type { EditorState } from '../src/tui/editor.ts'

/** Applies a sequence of actions in order, threading state through, and returns the final state. */
function run(state: EditorState, ...types: Array<Parameters<typeof editorReduce>[1]>): EditorState {
  let current = state
  for (const action of types) {
    current = editorReduce(current, action).state
  }
  return current
}

describe('stripPasteMarkers', () => {
  it('removes bracketed-paste start and end frames', () => {
    expect(stripPasteMarkers('\x1b[200~hello\x1b[201~')).toBe('hello')
  })

  it('removes multiple occurrences anywhere in the string', () => {
    expect(stripPasteMarkers('\x1b[200~a\x1b[201~\x1b[200~b\x1b[201~')).toBe('ab')
  })

  it('is a no-op on text without paste markers', () => {
    expect(stripPasteMarkers('plain text')).toBe('plain text')
  })
})

describe('emptyEditor', () => {
  it('starts with a single empty line, cursor at 0,0, and empty history by default', () => {
    expect(emptyEditor()).toEqual({ lines: [''], row: 0, col: 0, history: [] })
  })

  it('accepts a seed history', () => {
    expect(emptyEditor(['first', 'second'])).toEqual({ lines: [''], row: 0, col: 0, history: ['first', 'second'] })
  })
})

describe('editorReduce — insert (typing builds a line)', () => {
  it('inserts characters at the cursor, advancing col', () => {
    const s1 = editorReduce(emptyEditor(), { type: 'insert', text: 'h' }).state
    const s2 = editorReduce(s1, { type: 'insert', text: 'i' }).state
    expect(s2).toEqual({ lines: ['hi'], row: 0, col: 2, history: [] })
  })

  it('inserts a multi-character chunk in one action (paste/burst)', () => {
    const s = editorReduce(emptyEditor(), { type: 'insert', text: 'hello' }).state
    expect(s.lines).toEqual(['hello'])
    expect(s.col).toBe(5)
  })

  it('inserts in the middle of a line at the cursor position', () => {
    const s1 = run(emptyEditor(), { type: 'insert', text: 'ac' }, { type: 'left' })
    const s2 = editorReduce(s1, { type: 'insert', text: 'b' }).state
    expect(s2.lines).toEqual(['abc'])
    expect(s2.col).toBe(2)
  })

  it('a no-op empty insert leaves state unchanged', () => {
    const s0 = editorReduce(emptyEditor(), { type: 'insert', text: 'x' }).state
    const s1 = editorReduce(s0, { type: 'insert', text: '' }).state
    expect(s1).toEqual(s0)
  })

  it('normalizes CRLF paste payloads to \\n and splits across lines', () => {
    const s = editorReduce(emptyEditor(), { type: 'insert', text: 'a\r\nb' }).state
    expect(s.lines).toEqual(['a', 'b'])
    expect(s.row).toBe(1)
    expect(s.col).toBe(1)
  })

  it('normalizes a lone CR to \\n as well', () => {
    const s = editorReduce(emptyEditor(), { type: 'insert', text: 'a\rb' }).state
    expect(s.lines).toEqual(['a', 'b'])
  })

  it('a multi-line paste inserted mid-line splices the surrounding text onto the first/last new lines', () => {
    const s0 = run(emptyEditor(), { type: 'insert', text: 'ad' }, { type: 'left' })
    const s1 = editorReduce(s0, { type: 'insert', text: 'B\nC' }).state
    expect(s1.lines).toEqual(['aB', 'Cd'])
    expect(s1.row).toBe(1)
    expect(s1.col).toBe(1)
  })
})

describe('editorReduce — newline (bound to alt+enter / ctrl+j only, per spec A6)', () => {
  it('splits the current line at the cursor into two lines', () => {
    const s0 = editorReduce(emptyEditor(), { type: 'insert', text: 'abcd' }).state
    const s1 = editorReduce({ ...s0, col: 2 }, { type: 'newline' }).state
    expect(s1.lines).toEqual(['ab', 'cd'])
    expect(s1.row).toBe(1)
    expect(s1.col).toBe(0)
  })

  it('typing after a newline continues on the new row', () => {
    const s0 = run(emptyEditor(), { type: 'insert', text: 'ab' }, { type: 'newline' }, { type: 'insert', text: 'cd' })
    expect(s0.lines).toEqual(['ab', 'cd'])
    expect(s0.row).toBe(1)
    expect(s0.col).toBe(2)
  })
})

describe('editorReduce — backspace', () => {
  it('deletes the character before the cursor within a line', () => {
    const s0 = editorReduce(emptyEditor(), { type: 'insert', text: 'abc' }).state
    const s1 = editorReduce(s0, { type: 'backspace' }).state
    expect(s1.lines).toEqual(['ab'])
    expect(s1.col).toBe(2)
  })

  it('joins the current line into the previous line when at col 0', () => {
    const s0 = run(emptyEditor(), { type: 'insert', text: 'ab' }, { type: 'newline' }, { type: 'insert', text: 'cd' })
    const s1 = editorReduce({ ...s0, col: 0 }, { type: 'backspace' }).state
    expect(s1.lines).toEqual(['abcd'])
    expect(s1.row).toBe(0)
    expect(s1.col).toBe(2)
  })

  it('is a no-op at row 0, col 0', () => {
    const s0 = emptyEditor()
    const s1 = editorReduce(s0, { type: 'backspace' }).state
    expect(s1).toEqual(s0)
  })
})

describe('editorReduce — delete-word (ctrl+w)', () => {
  it('deletes the word immediately before the cursor', () => {
    const s0 = editorReduce(emptyEditor(), { type: 'insert', text: 'foo bar' }).state
    const s1 = editorReduce(s0, { type: 'delete-word' }).state
    expect(s1.lines).toEqual(['foo '])
    expect(s1.col).toBe(4)
  })

  it('also consumes trailing whitespace before the word', () => {
    const s0 = editorReduce(emptyEditor(), { type: 'insert', text: 'foo   ' }).state
    const s1 = editorReduce(s0, { type: 'delete-word' }).state
    expect(s1.lines).toEqual([''])
    expect(s1.col).toBe(0)
  })

  it('is a no-op at col 0', () => {
    const s0 = emptyEditor()
    const s1 = editorReduce(s0, { type: 'delete-word' }).state
    expect(s1).toEqual(s0)
  })
})

describe('editorReduce — cursor movement', () => {
  it('left/right move within a line and stop at the edges', () => {
    const s0 = editorReduce(emptyEditor(), { type: 'insert', text: 'hi' }).state
    const s1 = editorReduce(s0, { type: 'left' }).state
    expect(s1.col).toBe(1)
    const s2 = run(s1, { type: 'left' }, { type: 'left' })
    expect(s2.col).toBe(0)
    const s3 = run(s2, { type: 'right' }, { type: 'right' }, { type: 'right' })
    expect(s3.col).toBe(2)
  })

  it('left at col 0 wraps to the end of the previous line', () => {
    const s0 = run(emptyEditor(), { type: 'insert', text: 'ab' }, { type: 'newline' }, { type: 'insert', text: 'c' })
    const s1 = editorReduce({ ...s0, col: 0 }, { type: 'left' }).state
    expect(s1.row).toBe(0)
    expect(s1.col).toBe(2)
  })

  it('right at end of line wraps to the start of the next line', () => {
    const s0 = run(emptyEditor(), { type: 'insert', text: 'ab' }, { type: 'newline' }, { type: 'insert', text: 'c' })
    const s1 = editorReduce({ ...s0, row: 0, col: 2 }, { type: 'right' }).state
    expect(s1.row).toBe(1)
    expect(s1.col).toBe(0)
  })

  it('up/down move between rows, clamping col to the shorter line length', () => {
    const s0 = run(
      emptyEditor(),
      { type: 'insert', text: 'abcd' },
      { type: 'newline' },
      { type: 'insert', text: 'xy' },
    )
    expect(s0.row).toBe(1)
    expect(s0.col).toBe(2)
    const s1 = editorReduce(s0, { type: 'up' }).state
    expect(s1.row).toBe(0)
    expect(s1.col).toBe(2)
    const s2 = editorReduce(s1, { type: 'down' }).state
    expect(s2.row).toBe(1)
    expect(s2.col).toBe(2)
  })

  it('up at row 0 and down at the last row are no-ops', () => {
    const s0 = emptyEditor()
    expect(editorReduce(s0, { type: 'up' }).state).toEqual(s0)
    expect(editorReduce(s0, { type: 'down' }).state).toEqual(s0)
  })

  it('home moves to col 0, end moves to the end of the current line', () => {
    const s0 = editorReduce(emptyEditor(), { type: 'insert', text: 'hello' }).state
    const s1 = editorReduce(s0, { type: 'home' }).state
    expect(s1.col).toBe(0)
    const s2 = editorReduce(s1, { type: 'end' }).state
    expect(s2.col).toBe(5)
  })
})

describe('editorReduce — submit', () => {
  it('trims a single trailing newline, appends to history, and resets the buffer', () => {
    const s0 = run(emptyEditor(), { type: 'insert', text: 'ab' }, { type: 'newline' })
    const result = editorReduce(s0, { type: 'submit' })
    expect(result.submitted).toBe('ab')
    expect(result.state).toEqual({ lines: [''], row: 0, col: 0, history: ['ab'] })
  })

  it('does not touch interior newlines, only a single trailing one', () => {
    const s0 = run(
      emptyEditor(),
      { type: 'insert', text: 'ab' },
      { type: 'newline' },
      { type: 'insert', text: 'cd' },
      { type: 'newline' },
    )
    const result = editorReduce(s0, { type: 'submit' })
    expect(result.submitted).toBe('ab\ncd')
    expect(result.state.history).toEqual(['ab\ncd'])
  })

  it('submitting text with no trailing newline leaves it untouched', () => {
    const s0 = editorReduce(emptyEditor(), { type: 'insert', text: 'plain' }).state
    const result = editorReduce(s0, { type: 'submit' })
    expect(result.submitted).toBe('plain')
  })

  it('accumulates multiple submits into history in order', () => {
    let state = emptyEditor()
    let r = editorReduce(editorReduce(state, { type: 'insert', text: 'one' }).state, { type: 'submit' })
    state = r.state
    r = editorReduce(editorReduce(state, { type: 'insert', text: 'two' }).state, { type: 'submit' })
    state = r.state
    expect(state.history).toEqual(['one', 'two'])
  })

  it('resets historyCursor/draft bookkeeping so a fresh submit does not carry navigation state', () => {
    const seeded = emptyEditor(['old'])
    const navigating = editorReduce(seeded, { type: 'history-prev' }).state
    expect(navigating.historyCursor).toBe(0)
    const result = editorReduce(editorReduce(navigating, { type: 'insert', text: 'x' }).state, { type: 'submit' })
    expect(result.state.historyCursor).toBeUndefined()
  })
})

describe('editorReduce — history-prev/history-next (replace buffer, restore the draft)', () => {
  function withHistory(...entries: string[]): EditorState {
    return emptyEditor(entries)
  }

  it('history-prev is a no-op when history is empty', () => {
    const s0 = emptyEditor()
    expect(editorReduce(s0, { type: 'history-prev' }).state).toEqual(s0)
  })

  it('history-prev loads the most recent entry first, cursor at its end', () => {
    const s0 = withHistory('first', 'second')
    const s1 = editorReduce(s0, { type: 'history-prev' }).state
    expect(s1.lines).toEqual(['second'])
    expect(s1.col).toBe('second'.length)
    expect(s1.historyCursor).toBe(1)
  })

  it('repeated history-prev walks further back and stops at the oldest entry', () => {
    const s0 = withHistory('first', 'second', 'third')
    const s1 = run(s0, { type: 'history-prev' }, { type: 'history-prev' }, { type: 'history-prev' })
    expect(s1.lines).toEqual(['first'])
    expect(s1.historyCursor).toBe(0)
    const s2 = editorReduce(s1, { type: 'history-prev' }).state
    expect(s2).toEqual(s1)
  })

  it('history-next is a no-op when not currently navigating', () => {
    const s0 = withHistory('first')
    expect(editorReduce(s0, { type: 'history-next' }).state).toEqual(s0)
  })

  it('history-next walks forward through history and then restores the pre-navigation draft', () => {
    const drafted = editorReduce(withHistory('first', 'second'), { type: 'insert', text: 'unsent draft' }).state
    const navBack = editorReduce(drafted, { type: 'history-prev' }).state
    expect(navBack.lines).toEqual(['second'])

    const olderStill = editorReduce(navBack, { type: 'history-prev' }).state
    expect(olderStill.lines).toEqual(['first'])

    const forwardAgain = editorReduce(olderStill, { type: 'history-next' }).state
    expect(forwardAgain.lines).toEqual(['second'])
    expect(forwardAgain.historyCursor).toBe(1)

    const restored = editorReduce(forwardAgain, { type: 'history-next' }).state
    expect(restored.lines).toEqual(['unsent draft'])
    expect(restored.col).toBe('unsent draft'.length)
    expect(restored.historyCursor).toBeUndefined()
  })

  it('restores an empty draft when navigation began on an empty buffer', () => {
    const s0 = withHistory('only')
    const navigated = editorReduce(s0, { type: 'history-prev' }).state
    const restored = editorReduce(navigated, { type: 'history-next' }).state
    expect(restored).toEqual(emptyEditor(['only']))
  })

  it('loads a multi-line history entry across multiple lines, cursor at the end', () => {
    const s0 = withHistory('a\nb\nc')
    const s1 = editorReduce(s0, { type: 'history-prev' }).state
    expect(s1.lines).toEqual(['a', 'b', 'c'])
    expect(s1.row).toBe(2)
    expect(s1.col).toBe(1)
  })
})
