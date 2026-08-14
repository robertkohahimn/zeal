import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { redirectDiagnostics } from '../src/tui/stdio.ts'

describe('redirectDiagnostics', () => {
  let dir: string | undefined

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = undefined
  })

  it('appends console.error output to the log file and restores stderr on restore()', () => {
    dir = mkdtempSync(join(tmpdir(), 'zeal-stdio-'))
    const logPath = join(dir, 'nested', 'zeal.log')

    const originalStderrWrite = process.stderr.write
    const restore = redirectDiagnostics(logPath)
    // The redirect must actually patch stderr.write — proof it is not a no-op.
    expect(process.stderr.write).not.toBe(originalStderrWrite)

    console.error('x')
    const contents = readFileSync(logPath, 'utf8')
    expect(contents).toContain('x')

    restore()
    expect(process.stderr.write).toBe(originalStderrWrite)
  })

  it('creates the log file\'s parent directory when it does not exist', () => {
    dir = mkdtempSync(join(tmpdir(), 'zeal-stdio-'))
    const logPath = join(dir, 'a', 'b', 'c', 'zeal.log')
    const restore = redirectDiagnostics(logPath)
    console.log('created')
    restore()
    expect(readFileSync(logPath, 'utf8')).toContain('created')
  })

  it('redirects process.stderr.write, console.log, and console.warn, all restored together', () => {
    dir = mkdtempSync(join(tmpdir(), 'zeal-stdio-'))
    const logPath = join(dir, 'zeal.log')
    const originalLog = console.log
    const originalWarn = console.warn
    const originalError = console.error

    const restore = redirectDiagnostics(logPath)
    process.stderr.write('raw-stderr-line\n')
    console.log('log-line')
    console.warn('warn-line')
    console.error('error-line')

    const contents = readFileSync(logPath, 'utf8')
    expect(contents).toContain('raw-stderr-line')
    expect(contents).toContain('log-line')
    expect(contents).toContain('warn-line')
    expect(contents).toContain('error-line')

    restore()
    expect(console.log).toBe(originalLog)
    expect(console.warn).toBe(originalWarn)
    expect(console.error).toBe(originalError)
  })

  it('restore() is idempotent — calling it twice does not throw', () => {
    dir = mkdtempSync(join(tmpdir(), 'zeal-stdio-'))
    const logPath = join(dir, 'zeal.log')
    const restore = redirectDiagnostics(logPath)
    console.log('once')
    restore()
    expect(() => restore()).not.toThrow()
  })
})
