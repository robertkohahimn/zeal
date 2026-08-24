import { describe, expect, it, vi } from 'vitest'
import type { CommandSeam, LocalCommand } from '../src/tui/commands.ts'
import { CommandDispatcher, helpText } from '../src/tui/commands.ts'

/** Fake seam shaped exactly like the installed `CommandService` surface: `list` is synchronous, `execute` settles a `CommandExecution` (`{ commandId, result: { kind, text? } }`) or `undefined` for invalid syntax/unknown name. */
function fakeSeam(overrides: Partial<CommandSeam> = {}): CommandSeam {
  return {
    list: () => [
      { name: 'compact', description: 'Compact the session' },
      { name: 'clear', description: 'Clear the transcript' },
    ],
    execute: async (_agent, line) => {
      if (line.startsWith('/compact')) {
        return { commandId: 'cmd_1', result: { kind: 'success', text: 'compacted' } }
      }
      return undefined
    },
    ...overrides,
  }
}

function fakeLocals(): LocalCommand[] {
  return [
    { name: 'help', description: 'Show help', run: async () => 'local help text' },
    { name: 'quit', description: 'Quit', run: async () => undefined },
    { name: 'model', description: 'Switch model', run: async (input) => `switched to${input}` },
  ]
}

describe('CommandDispatcher', () => {
  describe('isCommand', () => {
    it('is true for a line starting with /', () => {
      const d = new CommandDispatcher({ locals: [] })
      expect(d.isCommand('/help')).toBe(true)
    })

    it('is false for a non-slash line', () => {
      const d = new CommandDispatcher({ locals: [] })
      expect(d.isCommand('hello there')).toBe(false)
      expect(d.isCommand('')).toBe(false)
    })
  })

  describe('dispatch', () => {
    it('routes a local command name before consulting the seam, even when the seam has a same-named command', async () => {
      // The seam below also exposes 'help' — the local must win.
      const seam = fakeSeam({
        list: () => [{ name: 'help', description: 'seam help, should never win' }],
        execute: async () => ({ commandId: 'cmd_x', result: { kind: 'success', text: 'seam help text' } }),
      })
      const d = new CommandDispatcher({ seam, agent: {}, locals: fakeLocals() })
      const outcome = await d.dispatch('/help')
      expect(outcome).toEqual({ handled: true, uiText: 'local help text' })
    })

    it('passes the remainder of the line to the local command as input', async () => {
      const d = new CommandDispatcher({ locals: fakeLocals() })
      const outcome = await d.dispatch('/model glm-4.7')
      expect(outcome.handled).toBe(true)
      expect(outcome.uiText).toContain('glm-4.7')
    })

    it('omits uiText when a local command resolves with no text', async () => {
      const d = new CommandDispatcher({ locals: fakeLocals() })
      const outcome = await d.dispatch('/quit')
      expect(outcome).toEqual({ handled: true })
      expect('uiText' in outcome).toBe(false)
    })

    it('routes an unmatched command name to the seam and surfaces its uiText', async () => {
      const seam = fakeSeam()
      const d = new CommandDispatcher({ seam, agent: {}, locals: fakeLocals() })
      const outcome = await d.dispatch('/compact now')
      expect(outcome).toEqual({ handled: true, uiText: 'compacted' })
    })

    it('reports handled: false for an unknown command the seam rejects', async () => {
      const seam = fakeSeam()
      const d = new CommandDispatcher({ seam, agent: {}, locals: fakeLocals() })
      const outcome = await d.dispatch('/nope')
      expect(outcome).toEqual({ handled: false })
    })

    it('reports handled: false when no seam is configured and no local name matches', async () => {
      const d = new CommandDispatcher({ locals: fakeLocals() })
      const outcome = await d.dispatch('/compact now')
      expect(outcome).toEqual({ handled: false })
    })

    it('still routes local commands correctly when no seam is configured', async () => {
      const d = new CommandDispatcher({ locals: fakeLocals() })
      const outcome = await d.dispatch('/help')
      expect(outcome).toEqual({ handled: true, uiText: 'local help text' })
    })

    it('returns handled: false without touching locals or seam for a non-slash line', async () => {
      const seam = fakeSeam()
      const execute = vi.fn(seam.execute)
      const localRun = vi.fn(async () => 'should not run')
      const d = new CommandDispatcher({
        seam: { ...seam, execute },
        agent: {},
        locals: [{ name: 'help', description: 'Show help', run: localRun }],
      })
      const outcome = await d.dispatch('not a command')
      expect(outcome).toEqual({ handled: false })
      expect(execute).not.toHaveBeenCalled()
      expect(localRun).not.toHaveBeenCalled()
    })

    it('forwards the abort signal through to seam.execute', async () => {
      const controller = new AbortController()
      const execute = vi.fn(async () => ({ commandId: 'cmd_2', result: { kind: 'success' as const, text: 'ok' } }))
      const d = new CommandDispatcher({ seam: { list: () => [], execute }, agent: {}, locals: [] })
      await d.dispatch('/compact', controller.signal)
      expect(execute).toHaveBeenCalledWith({}, '/compact', controller.signal)
    })
  })

  describe('completions', () => {
    it('merges seam and local names, deduping a shared name, and sorts', () => {
      const seam = fakeSeam() // exposes 'compact' and 'clear'
      const d = new CommandDispatcher({ seam, agent: {}, locals: fakeLocals() }) // exposes 'help', 'quit', 'model'
      expect(d.completions('/c')).toEqual(['/clear', '/compact'])
      expect(d.completions('/')).toEqual(['/clear', '/compact', '/help', '/model', '/quit'])
    })

    it('dedupes a name present in both seam and locals', () => {
      const seam = fakeSeam({ list: () => [{ name: 'help', description: 'seam help' }] })
      const d = new CommandDispatcher({ seam, agent: {}, locals: fakeLocals() })
      expect(d.completions('/help')).toEqual(['/help'])
    })

    it('works from locals alone when no seam is configured', () => {
      const d = new CommandDispatcher({ locals: fakeLocals() })
      expect(d.completions('/')).toEqual(['/help', '/model', '/quit'])
    })

    it('matches case-insensitively, consistent with dispatch\'s lowercasing — /Mo completes what /Model dispatches', () => {
      const d = new CommandDispatcher({ locals: fakeLocals() })
      expect(d.completions('/Mo')).toEqual(['/model'])
    })
  })
})

describe('helpText', () => {
  it('lists every merged command with its description', () => {
    const seam = fakeSeam()
    const d = new CommandDispatcher({ seam, agent: {}, locals: fakeLocals() })
    const text = helpText(d)
    expect(text).toContain('/clear')
    expect(text).toContain('Clear the transcript')
    expect(text).toContain('/help')
    expect(text).toContain('Show help')
  })

  it("a local's description wins over a same-named seam descriptor", () => {
    const seam = fakeSeam({ list: () => [{ name: 'help', description: 'seam description, should not appear' }] })
    const d = new CommandDispatcher({ seam, agent: {}, locals: fakeLocals() })
    const text = helpText(d)
    expect(text).toContain('Show help')
    expect(text).not.toContain('seam description, should not appear')
  })
})
