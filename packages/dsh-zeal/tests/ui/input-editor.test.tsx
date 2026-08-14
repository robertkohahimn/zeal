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

  it('a bracketed-paste chunk is stripped of its markers and inserted', async () => {
    const onSubmit = vi.fn()
    const { stdin } = render(<InputEditor onSubmit={onSubmit} />)
    await press(stdin, '\x1b[200~pasted~\x1b[201~', '\r')
    expect(onSubmit).toHaveBeenCalledWith('pasted~')
  })
})
