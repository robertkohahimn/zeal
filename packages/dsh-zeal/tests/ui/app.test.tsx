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

  // IMPORTANT 4 (Task 14 review): `dispatcher.dispatch(line)` can reject —
  // a throwing seam command — and without a `.catch` that becomes an
  // unhandled promise rejection instead of an in-TUI error. Vitest fails a
  // run on an unhandled rejection, so this test's mere passing (plus the
  // asserted notice) is the regression check.
  it('a rejecting seam command renders an error notice instead of an unhandled rejection', async () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    const driver = fakeDriver()
    const seam = {
      list: () => [{ name: 'boom', description: 'Always throws' }],
      execute: async (): Promise<never> => {
        throw new Error('seam exploded')
      },
    }
    const dispatcher = new CommandDispatcher({ seam, agent: {}, locals: [] })
    const { stdin, lastFrame } = render(
      <App store={store} driver={driver} dispatcher={dispatcher} onQuit={vi.fn()} onResume={vi.fn()} />,
    )
    await press(stdin, '/boom', '\r')
    await settle()
    expect(lastFrame()!).toContain('Command failed: seam exploded')
    expect(driver.sendCalls).toEqual([])
  })

  // IMPORTANT 5 (Task 14 review): the editor must stay inert for the WHOLE
  // resume await, and typed input during that window must never reach
  // `driver.send()` on the driver that's about to be disposed/replaced.
  it('typing during an in-flight resume is swallowed (editor inert); post-resume input reaches only the new driver', async () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    const driver = fakeDriver()
    const newDriver = fakeDriver()
    let resolveResume: ((value: { driver: AppDriver; dispatcher: CommandDispatcher }) => void) | undefined
    const onResume = vi.fn(
      () =>
        new Promise<{ driver: AppDriver; dispatcher: CommandDispatcher }>((resolve) => {
          resolveResume = resolve
        }),
    )
    const { stdin } = render(
      <App store={store} driver={driver} dispatcher={buildDispatcher()} onQuit={vi.fn()} onResume={onResume} />,
    )
    await press(stdin, '/resume sess-1', '\r')
    await settle()
    expect(onResume).toHaveBeenCalledTimes(1)

    // Typed WHILE the resume is still pending — must not reach either driver.
    await press(stdin, 'hello', '\r')
    expect(driver.sendCalls).toEqual([])
    expect(newDriver.sendCalls).toEqual([])

    // A second resume attempt while one is in flight is ignored outright.
    await press(stdin, '/resume sess-2', '\r')
    await settle()
    expect(onResume).toHaveBeenCalledTimes(1)

    resolveResume!({ driver: newDriver, dispatcher: buildDispatcher() })
    await settle()

    await press(stdin, 'world', '\r')
    expect(newDriver.sendCalls).toEqual(['world'])
    expect(driver.sendCalls).toEqual([])
  })

  // IMPORTANT 5, targeted: two picker selections fired in the SAME
  // synchronous tick (no yield between the two `stdin.write` calls) must
  // still only trigger one `onResume` call. `resuming` (React state) alone
  // would not catch this — it batches — so `performResume`'s guard must be
  // a synchronous `ref`, not state. Mirrors the "same-tick burst" hazard
  // `InputEditor.tsx`'s tests already cover for a different component.
  it('two picker selections in the same tick trigger only one resume (re-entry guard survives a same-tick race)', async () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    const driver = fakeDriver()
    driver.listSessionsResult = [
      { sessionId: 'sess-a', createdAt: 1, live: false, title: 'A' },
      { sessionId: 'sess-b', createdAt: 2, live: false, title: 'B' },
    ]
    const newDriver = fakeDriver()
    const onResume = vi.fn(async (_sessionId: string) => ({ driver: newDriver, dispatcher: buildDispatcher() }))
    const { stdin } = render(
      <App store={store} driver={driver} dispatcher={buildDispatcher()} onQuit={vi.fn()} onResume={onResume} />,
    )
    await press(stdin, '/resume', '\r')
    await settle()

    // No yield between these two writes — same synchronous burst.
    stdin.write('1')
    stdin.write('2')
    await settle()

    expect(onResume).toHaveBeenCalledTimes(1)
    expect(onResume).toHaveBeenCalledWith('sess-a')
  })

  // I6a → v2: while the input starts with '/', the editor's hint line lists
  // matching command names from the dispatcher (capped at 6), and Tab cycles
  // them — the selection state lives in `InputEditor`, App only supplies the
  // completion source via its `getCompletions` prop.
  describe('slash-command autocomplete (I6a, v2 Tab cycling)', () => {
    it('shows no hint before any "/" is typed', async () => {
      const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
      const driver = fakeDriver()
      const { stdin, lastFrame } = render(
        <App store={store} driver={driver} dispatcher={buildDispatcher()} onQuit={vi.fn()} onResume={vi.fn()} />,
      )
      await press(stdin, 'hello')
      await settle()
      const frame = lastFrame()!
      expect(frame).not.toContain('/help')
      expect(frame).not.toContain('/model')
    })

    it('shows a dim hint listing matching command names while the line starts with "/"', async () => {
      const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
      const driver = fakeDriver()
      const { stdin, lastFrame } = render(
        <App store={store} driver={driver} dispatcher={buildDispatcher()} onQuit={vi.fn()} onResume={vi.fn()} />,
      )
      // Of the four fakeLocals (help, quit, model, resume), only "help"
      // starts with "h" — an unambiguous single-match assertion.
      await press(stdin, '/h')
      await settle()
      expect(lastFrame()!).toContain('/help')

      // The hint disappears again once the line no longer starts with '/'
      // (e.g. the command is submitted and the buffer clears).
      await press(stdin, '\r')
      await settle()
      expect(lastFrame()!).not.toContain('/help')
    })

    it('caps the hint at 6 matching command names', async () => {
      const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
      const driver = fakeDriver()
      const manyLocals: LocalCommand[] = Array.from({ length: 8 }, (_, i) => ({
        name: `cmd${i + 1}`,
        description: `Command ${i + 1}`,
        run: async () => undefined,
      }))
      const dispatcher = new CommandDispatcher({ locals: manyLocals })
      const { stdin, lastFrame } = render(
        <App store={store} driver={driver} dispatcher={dispatcher} onQuit={vi.fn()} onResume={vi.fn()} />,
      )
      await press(stdin, '/c')
      const frame = lastFrame()!
      for (let i = 1; i <= 6; i++) expect(frame).toContain(`/cmd${i}`)
      expect(frame).not.toContain('/cmd7')
      expect(frame).not.toContain('/cmd8')
    })

    it('tab completes a command end-to-end through the real dispatcher source, ready to submit', async () => {
      const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
      const driver = fakeDriver()
      const { stdin, lastFrame } = render(
        <App store={store} driver={driver} dispatcher={buildDispatcher()} onQuit={vi.fn()} onResume={vi.fn()} />,
      )
      // Of the four fakeLocals only 'model' starts with '/m' — a unique
      // fresh match, so Tab completes to '/model ' (argument space).
      await press(stdin, '/m', '\t')
      await settle()
      expect(lastFrame()!).toContain('> /model')
      // Submitting the completed line dispatches through the local command,
      // exactly as typing it out would have.
      await press(stdin, 'glm-4.7', '\r')
      await settle()
      expect(lastFrame()!).toContain('switched to glm-4.7')
      expect(driver.sendCalls).toEqual([])
    })
  })

  // IMPORTANT 5: Esc must not call `interrupt()` on a driver mid-resume —
  // the `driver` reference during that window is the OLD one, about to be
  // disposed by `index.ts`'s `resumeDriver`.
  it('Esc during an in-flight resume does not call interrupt() on the retiring driver', async () => {
    const store = new ZealStore({ provider: 'zai', model: 'glm-5.2' })
    const driver = fakeDriver()
    let resolveResume: ((value: { driver: AppDriver; dispatcher: CommandDispatcher }) => void) | undefined
    const onResume = vi.fn(
      () =>
        new Promise<{ driver: AppDriver; dispatcher: CommandDispatcher }>((resolve) => {
          resolveResume = resolve
        }),
    )
    const { stdin } = render(
      <App store={store} driver={driver} dispatcher={buildDispatcher()} onQuit={vi.fn()} onResume={onResume} />,
    )
    await press(stdin, '/resume sess-1', '\r')
    await settle()

    stdin.write('\x1b')
    await settle()
    expect(driver.interruptCount).toBe(0)

    resolveResume!({ driver: fakeDriver(), dispatcher: buildDispatcher() })
    await settle()
  })
})
