import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { StatusBar } from '../../src/tui/ui/StatusBar.tsx'
import type { StatusModel } from '../../src/tui/model.ts'

describe('StatusBar', () => {
  it('contains provider/model and the running hint while a turn is in flight', () => {
    const status: StatusModel = { provider: 'zai', model: 'glm-4.6', running: true }
    const { lastFrame } = render(<StatusBar status={status} width={80} />)
    const frame = lastFrame()!
    expect(frame).toContain('zai/glm-4.6')
    expect(frame).toContain('⏵ running (esc interrupts)')
  })

  it('shows "idle" instead of the running hint when no turn is in flight', () => {
    const status: StatusModel = { provider: 'zai', model: 'glm-4.6', running: false }
    const { lastFrame } = render(<StatusBar status={status} width={80} />)
    const frame = lastFrame()!
    expect(frame).toContain('idle')
    expect(frame).not.toContain('running')
  })

  it('falls back to "new session" when title is absent', () => {
    const status: StatusModel = { provider: 'zai', model: 'glm-4.6', running: false }
    const { lastFrame } = render(<StatusBar status={status} width={80} />)
    expect(lastFrame()!).toContain('new session')
  })

  it('shows the title when present, not the fallback', () => {
    const status: StatusModel = { provider: 'zai', model: 'glm-4.6', running: false, title: 'Refactor parser' }
    const { lastFrame } = render(<StatusBar status={status} width={80} />)
    const frame = lastFrame()!
    expect(frame).toContain('Refactor parser')
    expect(frame).not.toContain('new session')
  })

  it('omits sandboxMode and retry segments when absent', () => {
    const status: StatusModel = { provider: 'zai', model: 'glm-4.6', running: false }
    const { lastFrame } = render(<StatusBar status={status} width={80} />)
    const frame = lastFrame()!
    // No stray separator runs left behind where an omitted segment would go…
    expect(frame).not.toMatch(/·\s*·\s*·/)
    // …and truly ABSENT, not rendered as an empty/undefined segment: nothing
    // sandbox- or retry-shaped may appear anywhere in the frame.
    expect(frame).not.toContain('undefined')
    expect(frame.toLowerCase()).not.toContain('sandbox')
    expect(frame.toLowerCase()).not.toContain('retry')
  })

  it('shows sandboxMode and retry when present', () => {
    const status: StatusModel = {
      provider: 'zai',
      model: 'glm-4.6',
      running: false,
      sandboxMode: 'sandboxed',
      retry: 'retry 2/5',
    }
    const { lastFrame } = render(<StatusBar status={status} width={80} />)
    const frame = lastFrame()!
    expect(frame).toContain('sandboxed')
    expect(frame).toContain('retry 2/5')
  })

  it('renders context fill as a rounded percentage when present', () => {
    const status: StatusModel = { provider: 'zai', model: 'glm-4.6', running: false, contextFill: 0.4567 }
    const { lastFrame } = render(<StatusBar status={status} width={80} />)
    expect(lastFrame()!).toContain('ctx 46%')
  })

  it('omits the ctx segment entirely when contextFill is absent', () => {
    const status: StatusModel = { provider: 'zai', model: 'glm-4.6', running: false }
    const { lastFrame } = render(<StatusBar status={status} width={80} />)
    expect(lastFrame()!).not.toContain('ctx ')
  })

  // Spec rule N1: zai catalogs price everything at 0, so a derived cost
  // would be confidently wrong. The status line must never render a dollar
  // amount, under any status combination.
  it('never renders a dollar amount', () => {
    const status: StatusModel = {
      provider: 'zai',
      model: 'glm-4.6',
      running: true,
      title: 'Some task',
      sandboxMode: 'sandboxed',
      retry: 'retry 1/3',
      contextFill: 0.9,
    }
    const { lastFrame } = render(<StatusBar status={status} width={80} />)
    expect(lastFrame()!).not.toContain('$')
  })

  it('includes the literal "zeal" segment', () => {
    const status: StatusModel = { provider: 'zai', model: 'glm-4.6', running: false }
    const { lastFrame } = render(<StatusBar status={status} width={80} />)
    expect(lastFrame()!).toContain('zeal')
  })
})
