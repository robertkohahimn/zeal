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

// v2: slash-command Tab completion. Ink reports both `\t` and `\x1b[Z`
// (shift+tab) as `key.tab` — with `input === ''`, since tab is in Ink's
// `nonAlphanumericKeys` — so these go through the real keypress parser the
// same way the arrow-key tests above do.
describe('InputEditor — slash-command Tab completion (v2)', () => {
  it('tab completes a unique fresh match with a trailing space ready for the argument', async () => {
    const onSubmit = vi.fn()
    const { stdin, lastFrame } = render(
      <InputEditor onSubmit={onSubmit} getCompletions={(line) => ['/help'].filter((n) => n.startsWith(line))} />,
    )
    await press(stdin, '/h', '\t')
    expect(lastFrame()!).toContain('> /help')
    // The trailing space is invisible in a frame assertion (frames trim line
    // tails), so prove it through what actually gets submitted.
    await press(stdin, '\r')
    expect(onSubmit).toHaveBeenCalledWith('/help ')
  })

  it('tab cycles forward through multiple candidates and shift+tab cycles back, wrapping', async () => {
    const candidates = ['/alpha', '/beta', '/gamma']
    const { stdin, lastFrame } = render(
      <InputEditor onSubmit={vi.fn()} getCompletions={(line) => candidates.filter((n) => n.startsWith(line))} />,
    )
    await press(stdin, '/', '\t')
    expect(lastFrame()!).toContain('> /alpha')
    await press(stdin, '\t')
    expect(lastFrame()!).toContain('> /beta')
    await press(stdin, '\t')
    expect(lastFrame()!).toContain('> /gamma')
    await press(stdin, '\t')
    expect(lastFrame()!).toContain('> /alpha') // wrapped
    await press(stdin, '\x1b[Z') // shift+tab — one step back
    expect(lastFrame()!).toContain('> /gamma')
  })

  it('the hint keeps listing the ANCHORED prefix\'s candidates while cycling', async () => {
    const candidates = ['/alpha', '/beta', '/gamma']
    const { stdin, lastFrame } = render(
      <InputEditor onSubmit={vi.fn()} getCompletions={(line) => candidates.filter((n) => n.startsWith(line))} />,
    )
    await press(stdin, '/', '\t', '\t')
    const frame = lastFrame()!
    // All three remain listed (the anchor is still '/'), even though the
    // buffer now reads '/beta' — without anchoring, the list would have
    // collapsed to just the selected candidate.
    expect(frame).toContain('/alpha')
    expect(frame).toContain('/beta')
    expect(frame).toContain('/gamma')
  })

  it('typing after cycling re-anchors on the edited prefix', async () => {
    const onSubmit = vi.fn()
    const candidates = ['/ab', '/abc']
    const { stdin } = render(
      <InputEditor onSubmit={onSubmit} getCompletions={(line) => candidates.filter((n) => n.startsWith(line))} />,
    )
    // '/a' matches both: tab selects '/ab' (no trailing space — not unique).
    await press(stdin, '/a', '\t')
    // Extending it with 'c' makes the match unique and FRESH again, so the
    // next tab completes with the argument space.
    await press(stdin, 'c', '\t', '\r')
    expect(onSubmit).toHaveBeenCalledWith('/abc ')
  })

  it('tab outside a command line is a no-op — nothing inserted, no crash', async () => {
    const onSubmit = vi.fn()
    const { stdin, lastFrame } = render(<InputEditor onSubmit={onSubmit} />)
    await press(stdin, 'hi', '\t')
    expect(lastFrame()!).toContain('> hi')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('tab with no matching candidates is a no-op', async () => {
    const { stdin, lastFrame } = render(
      <InputEditor onSubmit={vi.fn()} getCompletions={(line) => ['/help'].filter((n) => n.startsWith(line))} />,
    )
    await press(stdin, '/z', '\t')
    expect(lastFrame()!).toContain('> /z')
  })

  it('renders the dim candidate hint while the line starts with "/"', async () => {
    const { stdin, lastFrame } = render(
      <InputEditor
        onSubmit={vi.fn()}
        getCompletions={(line) => ['/help', '/model'].filter((n) => n.startsWith(line))}
      />,
    )
    await press(stdin, '/')
    const frame = lastFrame()!
    expect(frame).toContain('/help')
    expect(frame).toContain('/model')
    // The hint disappears once the line no longer starts with '/'.
    await press(stdin, '\x7f') // backspace removes the '/'
    expect(lastFrame()!).not.toContain('/help')
  })
})

// v2: kill-ring bindings. `\x0b` is ctrl+k (0x0B), `\x19` is ctrl+y (0x19),
// `\x1by` is alt+y — all through the real Ink keypress parser.
describe('InputEditor — kill-ring bindings (v2)', () => {
  it('ctrl+k kills to end of line; ctrl+y yanks it back at the cursor', async () => {
    const { stdin, lastFrame } = render(<InputEditor onSubmit={vi.fn()} />)
    await press(stdin, 'hello', '\x1b[D', '\x1b[D', '\x0b') // left, left, ctrl+k
    expect(lastFrame()!).toContain('> hel')
    await press(stdin, '\x19') // ctrl+y
    expect(lastFrame()!).toContain('> hello')
  })

  it('alt+y rotates to the older kill after a yank (yank-pop)', async () => {
    const { stdin, lastFrame } = render(<InputEditor onSubmit={vi.fn()} />)
    // home before each kill: at end of the line a kill would be a no-op.
    await press(stdin, 'one', '\x1b[H', '\x0b', 'two', '\x1b[H', '\x0b', '\x19') // ring ['two','one'], yank 'two'
    expect(lastFrame()!).toContain('> two')
    await press(stdin, '\x1by') // alt+y — replace with the older entry
    expect(lastFrame()!).toContain('> one')
  })

  it('the ring survives a submit — kill in one prompt, yank in the next', async () => {
    const onSubmit = vi.fn()
    const { stdin, lastFrame } = render(<InputEditor onSubmit={onSubmit} />)
    await press(stdin, 'abc', '\x1b[H', '\x0b', '\r', '\x19') // kill all, submit empty, yank
    expect(onSubmit).toHaveBeenCalledWith('')
    expect(lastFrame()!).toContain('> abc')
  })
})
