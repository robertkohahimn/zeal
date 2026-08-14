import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { App } from '../../src/tui/ui/App.tsx'
import type { AppDriver } from '../../src/tui/ui/App.tsx'
import { CommandDispatcher } from '../../src/tui/commands.ts'
import type { LocalCommand } from '../../src/tui/commands.ts'
import type { PickerRow } from '../../src/tui/driver.ts'
import { ZealStore } from '../../src/tui/store.ts'

/**
 * Same reasoning as `tests/ui/input-editor.test.tsx`'s `press` helper: Ink's
 * reconciler commits via `queueMicrotask`, and `useInput`'s handler is a
 * `useEffectEvent` whose closure only refreshes after a commit — yielding a
 * macrotask between writes lets each keystroke's state update land first.
 */
async function press(stdin: { write: (data: string) => void }, ...chunks: string[]): Promise<void> {
  for (const chunk of chunks) {
    stdin.write(chunk)
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
}

/** Yield long enough for the store's coalesced (16ms) notify timer to fire and React to re-render. */
async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 30))
}

interface FakeDriver extends AppDriver {
  sendCalls: string[]
  interruptCount: number
  switchModelCalls: Array<{ model: string; provider: string | undefined }>
  listSessionsResult: PickerRow[]
}

function fakeDriver(): FakeDriver {
  const driver: FakeDriver = {
    sendCalls: [],
    interruptCount: 0,
    switchModelCalls: [],
    listSessionsResult: [],
    send(text: string) {
      driver.sendCalls.push(text)
    },
    interrupt() {
      driver.interruptCount += 1
    },
    switchModel(model: string, provider?: string) {
      driver.switchModelCalls.push({ model, provider })
    },
    async listSessions() {
      return driver.listSessionsResult
    },
  }
  return driver
}

/** Mirrors `tests/commands.test.ts`'s `fakeLocals()`: the four driver-local commands `commands.ts`'s module doc names. */
function fakeLocals(): LocalCommand[] {
  return [
    { name: 'help', description: 'Show help', run: async () => 'help text here' },
    { name: 'quit', description: 'Quit', run: async () => undefined },
    { name: 'model', description: 'Switch model', run: async (input) => `switched to${input}` },
    { name: 'resume', description: 'Resume a session', run: async () => undefined },
  ]
}

function buildDispatcher(): CommandDispatcher {
  return new CommandDispatcher({ locals: fakeLocals() })
}

describe('App', () => {
  it('typing a line and pressing enter sends it to the driver', async () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    const driver = fakeDriver()
    const { stdin } = render(
      <App store={store} driver={driver} dispatcher={buildDispatcher()} onQuit={vi.fn()} onResume={vi.fn()} />,
    )
    await press(stdin, 'hello there', '\r')
    expect(driver.sendCalls).toEqual(['hello there'])
  })

  it('a bare-enter empty line is a no-op — no send, no dispatch', async () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    const driver = fakeDriver()
    const { stdin } = render(
      <App store={store} driver={driver} dispatcher={buildDispatcher()} onQuit={vi.fn()} onResume={vi.fn()} />,
    )
    await press(stdin, '\r')
    expect(driver.sendCalls).toEqual([])
  })

  it('/help dispatches to the local command and renders its uiText as a notice', async () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    const driver = fakeDriver()
    const { stdin, lastFrame } = render(
      <App store={store} driver={driver} dispatcher={buildDispatcher()} onQuit={vi.fn()} onResume={vi.fn()} />,
    )
    await press(stdin, '/help', '\r')
    await settle()
    expect(lastFrame()!).toContain('help text here')
    expect(driver.sendCalls).toEqual([])
  })

  it('/model <id> dispatches to the local command and renders its uiText', async () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    const driver = fakeDriver()
    const { stdin, lastFrame } = render(
      <App store={store} driver={driver} dispatcher={buildDispatcher()} onQuit={vi.fn()} onResume={vi.fn()} />,
    )
    await press(stdin, '/model glm-4.7', '\r')
    await settle()
    expect(lastFrame()!).toContain('glm-4.7')
  })

  it('an unrecognized command with no seam renders an error notice, and never reaches driver.send', async () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    const driver = fakeDriver()
    const { stdin, lastFrame } = render(
      <App store={store} driver={driver} dispatcher={buildDispatcher()} onQuit={vi.fn()} onResume={vi.fn()} />,
    )
    await press(stdin, '/nope', '\r')
    await settle()
    expect(lastFrame()!).toContain('Unknown command: /nope')
    expect(driver.sendCalls).toEqual([])
  })

  it('while an interaction is pending, the input editor is inert and the interaction panel handles input instead', async () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    const driver = fakeDriver()
    const decisionPromise = store.askApproval({ title: 'Run rm -rf build/', detail: 'delete build/', agentLabel: 'main' })
    const { stdin, lastFrame } = render(
      <App store={store} driver={driver} dispatcher={buildDispatcher()} onQuit={vi.fn()} onResume={vi.fn()} />,
    )
    await settle()
    expect(lastFrame()!).toContain('Run rm -rf build/')

    // Typed while inert: neither submitted to the driver nor inserted anywhere visible.
    await press(stdin, 'hello', '\r')
    expect(driver.sendCalls).toEqual([])

    // The interaction panel's own listener still resolves the prompt.
    await press(stdin, 'y')
    await expect(decisionPromise).resolves.toBe('allow-once')
  })

  it('Esc calls driver.interrupt()', async () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    const driver = fakeDriver()
    const { stdin } = render(
      <App store={store} driver={driver} dispatcher={buildDispatcher()} onQuit={vi.fn()} onResume={vi.fn()} />,
    )
    // A lone Esc byte is ambiguous with the start of a CSI/SS3 sequence until
    // more bytes arrive or don't — Ink's input parser holds it `'pending'`
    // and only flushes it as a genuine Escape keypress after its own 20ms
    // `pendingInputFlushDelayMilliseconds` timer (ink's `App.js`), so this
    // needs `settle()`'s longer wait, not `press()`'s single-tick yield.
    stdin.write('\x1b')
    await settle()
    expect(driver.interruptCount).toBe(1)
  })

  it('a single Ctrl+C shows the "press again" hint but does not quit; a second within the window quits', async () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    const driver = fakeDriver()
    const onQuit = vi.fn()
    const { stdin, lastFrame } = render(
      <App store={store} driver={driver} dispatcher={buildDispatcher()} onQuit={onQuit} onResume={vi.fn()} />,
    )
    await press(stdin, '\x03')
    expect(onQuit).not.toHaveBeenCalled()
    expect(lastFrame()!).toContain('press ctrl+c again to quit')

    await press(stdin, '\x03')
    expect(onQuit).toHaveBeenCalledTimes(1)
  })

  it('/resume with no id opens a picker from driver.listSessions(); selecting a row restarts the driver via onResume', async () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    const driver = fakeDriver()
    driver.listSessionsResult = [{ sessionId: 'sess-1', createdAt: 1000, live: false, title: 'Fix the bug' }]
    const newDriver = fakeDriver()
    const onResume = vi.fn(async (sessionId: string) => {
      expect(sessionId).toBe('sess-1')
      return { driver: newDriver, dispatcher: buildDispatcher() }
    })
    const { stdin, lastFrame } = render(
      <App store={store} driver={driver} dispatcher={buildDispatcher()} onQuit={vi.fn()} onResume={onResume} />,
    )
    await press(stdin, '/resume', '\r')
    await settle()
    expect(lastFrame()!).toContain('Fix the bug')

    await press(stdin, '1')
    await settle()
    expect(onResume).toHaveBeenCalledWith('sess-1')

    // Post-resume: submitted text now reaches the NEW driver, never the old one.
    await press(stdin, 'world', '\r')
    expect(newDriver.sendCalls).toEqual(['world'])
    expect(driver.sendCalls).toEqual([])
  })

  it('/resume <id> restarts the driver directly, without opening the picker', async () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    const driver = fakeDriver()
    const newDriver = fakeDriver()
    const onResume = vi.fn(async (sessionId: string) => {
      expect(sessionId).toBe('sess-42')
      return { driver: newDriver, dispatcher: buildDispatcher() }
    })
    const { stdin, lastFrame } = render(
      <App store={store} driver={driver} dispatcher={buildDispatcher()} onQuit={vi.fn()} onResume={onResume} />,
    )
    await press(stdin, '/resume sess-42', '\r')
    await settle()
    expect(onResume).toHaveBeenCalledWith('sess-42')
    expect(lastFrame()!).not.toContain('Resume session')
  })

  it('a rejected onResume (bad session id) renders an error notice instead of crashing', async () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    const driver = fakeDriver()
    const onResume = vi.fn(async () => {
      throw new Error('no such session: bad-id')
    })
    const { stdin, lastFrame } = render(
      <App store={store} driver={driver} dispatcher={buildDispatcher()} onQuit={vi.fn()} onResume={onResume} />,
    )
    await press(stdin, '/resume bad-id', '\r')
    await settle()
    expect(lastFrame()!).toContain('Failed to resume session bad-id')
    expect(lastFrame()!).toContain('no such session: bad-id')
  })
})
