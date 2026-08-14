import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { Markdown } from '../../src/tui/ui/Markdown.tsx'

describe('Markdown', () => {
  it('renders a heading, list, and code fence', () => {
    const { lastFrame } = render(
      <Markdown width={80} source={'# Title\n\n- one\n- two\n\n```js\nconst a = 1\n```'} />,
    )
    const frame = lastFrame()!
    expect(frame).toContain('Title')
    expect(frame).toContain('• one')
    expect(frame).toContain('const a = 1')
  })

  it('never exceeds the given width', () => {
    const long = 'x'.repeat(500)
    const { lastFrame } = render(<Markdown width={40} source={long} />)
    for (const line of lastFrame()!.split('\n')) expect(line.length).toBeLessThanOrEqual(40)
  })

  it('prefixes every blockquote line with "│ "', () => {
    const { lastFrame } = render(
      <Markdown width={80} source={'> a quoted line\n> continues here'} />,
    )
    const frame = lastFrame()!
    const quoted = frame.split('\n').filter((line) => line.includes('quoted') || line.includes('continues'))
    expect(quoted.length).toBeGreaterThan(0)
    for (const line of quoted) expect(line.startsWith('│ ')).toBe(true)
  })

  it('numbers ordered lists with "n."', () => {
    const { lastFrame } = render(<Markdown width={80} source={'1. first\n2. second'} />)
    const frame = lastFrame()!
    expect(frame).toContain('1. first')
    expect(frame).toContain('2. second')
  })

  it('renders inline code content distinctly (styling assertions are content-only, see note below)', () => {
    // NOTE: ink-testing-library's mock stdout is not a TTY, so chalk's automatic
    // color-support detection typically yields color level 0 in CI, meaning no
    // ANSI escape codes are emitted at all regardless of `color="cyan"` on the
    // <Text> node. Asserting on the *presence* of an ANSI escape sequence would
    // therefore be environment-dependent and flaky. We assert on content only.
    const { lastFrame } = render(<Markdown width={80} source={'Some `inline code` here'} />)
    const frame = lastFrame()!
    expect(frame).toContain('inline code')
  })

  it('renders bold and italic text content', () => {
    const { lastFrame } = render(<Markdown width={80} source={'This is **bold** and *italic* text'} />)
    const frame = lastFrame()!
    expect(frame).toContain('bold')
    expect(frame).toContain('italic')
  })

  it('wraps a long paragraph across multiple lines within width', () => {
    const words = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ')
    const { lastFrame } = render(<Markdown width={20} source={words} />)
    const lines = lastFrame()!.split('\n')
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(20)
  })
})
