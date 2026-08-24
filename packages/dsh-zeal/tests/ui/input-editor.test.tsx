import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { InputEditor } from '../../src/tui/ui/InputEditor.tsx'

/**
 * Same reasoning as `tests/ui/interaction.test.tsx`'s `press` helper: Ink's
 * reconciler commits via `queueMicrotask`, and `useInput`'s handler is a
 * `useEffectEvent` whose closure only refreshes after a commit. Two
 * `stdin.write()` calls fired back-to-back would have the second one land
 * before the first's `setState` has committed, so it would still see the
 * pre-insert (empty-buffer) closure — yielding a macrotask between writes
 * lets each keystroke's state update land first.
 */
async function press(stdin: { write: (data: string) => void }, ...chunks: string[]): Promise<void> {
  for (const chunk of chunks) {
    stdin.write(chunk)
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
}

describe('InputEditor', () => {
  it('typing "hi" then return submits "hi"', async () => {
    const onSubmit = vi.fn()
    const { stdin } = render(<InputEditor onSubmit={onSubmit} />)
    await press(stdin, 'hi', '\r')
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith('hi')
  })

  it('renders the typed text before submit', async () => {
    const onSubmit = vi.fn()
    const { stdin, lastFrame } = render(<InputEditor onSubmit={onSubmit} />)
    await press(stdin, 'hi')
    expect(lastFrame()!).toContain('hi')
  })

  it('clears the buffer after submit, ready for the next line', async () => {
    const onSubmit = vi.fn()
    const { stdin, lastFrame } = render(<InputEditor onSubmit={onSubmit} />)
    await press(stdin, 'hi', '\r')
    // Not a bare `not.toContain('hi')`: the dim keybinding hint's word
    // "history" contains "hi" as a substring, which would false-positive.
    // Check the actual rendered prompt line instead.
    expect(lastFrame()!).not.toContain('> hi')
  })

  it('alt+enter (meta+return) inserts a newline instead of submitting', async () => {
    const onSubmit = vi.fn()
    const { stdin, lastFrame } = render(<InputEditor onSubmit={onSubmit} />)
    await press(stdin, 'ab', '\x1b\r', 'cd')
    expect(onSubmit).not.toHaveBeenCalled()
    const frame = lastFrame()!
    expect(frame).toContain('ab')
    expect(frame).toContain('cd')
  })

  it('ctrl+j inserts a newline instead of submitting', async () => {
    const onSubmit = vi.fn()
    const { stdin, lastFrame } = render(<InputEditor onSubmit={onSubmit} />)
    await press(stdin, 'ab', '\n', 'cd')
    expect(onSubmit).not.toHaveBeenCalled()
    const frame = lastFrame()!
    expect(frame).toContain('ab')
    expect(frame).toContain('cd')
  })

  it('a bracketed-paste chunk (routed through usePaste, see module doc comment) is stripped of its markers and inserted', async () => {
    const onSubmit = vi.fn()
    const { stdin } = render(<InputEditor onSubmit={onSubmit} />)
    await press(stdin, '\x1b[200~pasted~\x1b[201~', '\r')
    expect(onSubmit).toHaveBeenCalledWith('pasted~')
  })
})

// Fix round 1, finding 1 (source-verified): without a dedicated `usePaste`
// listener, Ink's own input-parser silently re-injects unwrapped paste
// content through the SAME channel as ordinary keystrokes. A paste whose
// content is exactly `\r` (or contains one) then gets classified by
// `useInput`'s per-key parser exactly like a real Enter press, which
// previously triggered a premature `submit` and dropped the paste instead
// of inserting it. These assert the fix: paste content lands in the buffer,
// CR normalized, and never triggers `onSubmit`.
describe('InputEditor — paste content containing \\r (fix round 1, finding 1)', () => {
  it('a paste whose content is exactly a lone \\r is inserted (as a newline) and does not submit', async () => {
    const onSubmit = vi.fn()
    const { stdin } = render(<InputEditor onSubmit={onSubmit} />)
    await press(stdin, '\x1b[200~\r\x1b[201~')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('a paste containing an embedded \\r ("a\\rb") is inserted with CR normalized to a newline and does not submit', async () => {
    const onSubmit = vi.fn()
    const { stdin, lastFrame } = render(<InputEditor onSubmit={onSubmit} />)
    await press(stdin, '\x1b[200~a\rb\x1b[201~')
    expect(onSubmit).not.toHaveBeenCalled()
    const frame = lastFrame()!
    // Normalized CR splits the paste onto two lines, "a" and "b".
    expect(frame).toContain('> a')
    expect(frame).toContain('  b')
  })

  it('submitting after such a paste sends the full normalized content, not just a fragment', async () => {
    const onSubmit = vi.fn()
    const { stdin } = render(<InputEditor onSubmit={onSubmit} />)
    await press(stdin, '\x1b[200~a\rb\x1b[201~', '\r')
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith('a\nb')
  })
})

// Fix round 1, finding 2: `dispatch` used to read `state` from the render
// closure and call `setState(result.state)` with a plain value. Several
// keystrokes arriving in the same synchronous burst (no yield between
// `stdin.write()` calls, mirroring key repeat or several chunked reads
// landing before React flushes) each reduced from that SAME stale closure,
// so only the last `setState` call survived and earlier keystrokes were
// silently dropped. Fixed by moving the reduce (and the up/down
// history-vs-cursor routing decision) inside a `setState` functional
// updater, computed from the updater's own `prev`.
describe('InputEditor — same-tick bursts (fix round 1, finding 2)', () => {
  it('a same-tick burst of separate single-char keystrokes (no yields between writes) drops none of them', async () => {
    const onSubmit = vi.fn()
    const { stdin, lastFrame } = render(<InputEditor onSubmit={onSubmit} />)
    // Deliberately no `await`/yield between these three writes — each is
    // its own synchronous `stdin` event, exactly the scenario that used to
    // lose keystrokes to a stale closure.
    stdin.write('a')
    stdin.write('b')
    stdin.write('c')
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(lastFrame()!).toContain('> abc')
  })

  it('up-arrow routing uses the post-burst cursor position, not a stale pre-burst one', async () => {
    const onSubmit = vi.fn()
    const { stdin, lastFrame } = render(<InputEditor onSubmit={onSubmit} history={['old']} />)
    // Same tick: type "ab" then immediately press up, with no yield
    // between. The stale-state bug would route "up" using the pre-"ab"
    // cursor (row 0, col 0, the buffer's starting position) and misfire
    // history-prev, replacing the freshly-typed "ab" with the history
    // entry "old" instead of just moving the cursor left within "ab".
    stdin.write('ab')
    stdin.write('\x1b[A') // up arrow (CSI A)
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(lastFrame()!).toContain('> ab')
  })

  it('a same-tick burst that ends in return still submits exactly once, with all burst characters included', async () => {
    const onSubmit = vi.fn()
    const { stdin } = render(<InputEditor onSubmit={onSubmit} />)
    stdin.write('a')
    stdin.write('b')
    stdin.write('c')
    stdin.write('\r')
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith('abc')
  })

  it('a single fused chunk ending in \\r ("hello\\r" typed fast enough to coalesce) submits "hello" instead of parking a two-row draft', async () => {
    const onSubmit = vi.fn()
    const { stdin } = render(<InputEditor onSubmit={onSubmit} />)
    // One stdin write, body and Enter fused — the SSH-burst shape.
    stdin.write('hello\r')
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith('hello')
  })

  it('an INTERIOR \\r in a fused chunk stays an inserted newline (non-bracketed multi-line paste safety), only the trailing one submits', async () => {
    const onSubmit = vi.fn()
    const { stdin } = render(<InputEditor onSubmit={onSubmit} />)
    stdin.write('ab\rcd\r')
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith('ab\ncd')
  })
})
