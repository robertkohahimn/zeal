import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { redirectDiagnostics } from '../src/tui/stdio.ts'

describe('redirectDiagnostics', () => {
  let dir: string | undefined
  // Registered by each test right after redirecting, called from afterEach:
  // if an assertion throws before the test's own restore() call, the global
  // patches must not leak into other tests. restore() is idempotent, so the
  // explicit in-test calls can stay.
  let restoreAfter: (() => void) | undefined

  afterEach(() => {
    restoreAfter?.()
    restoreAfter = undefined
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = undefined
  })

  it('appends console.error output to the log file and restores stderr on restore()', () => {
    dir = mkdtempSync(join(tmpdir(), 'zeal-stdio-'))
    const logPath = join(dir, 'nested', 'zeal.log')

    const originalStderrWrite = process.stderr.write
    const restore = redirectDiagnostics(logPath)
    restoreAfter = restore
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
    restoreAfter = restore
    console.log('created')
    restore()
    expect(readFileSync(logPath, 'utf8')).toContain('created')
  })

  it('redirects process.stderr.write and every stdout/stderr-bound console method, all restored together', () => {
    dir = mkdtempSync(join(tmpdir(), 'zeal-stdio-'))
    const logPath = join(dir, 'zeal.log')
    const originalLog = console.log
    const originalWarn = console.warn
    const originalError = console.error
    const originalInfo = console.info
    const originalDebug = console.debug
    const originalTrace = console.trace

    const restore = redirectDiagnostics(logPath)
    restoreAfter = restore
    process.stderr.write('raw-stderr-line\n')
    console.log('log-line')
    console.warn('warn-line')
    console.error('error-line')
    console.info('info-line')
    console.debug('debug-line')
    console.trace('trace-line')

    const contents = readFileSync(logPath, 'utf8')
    expect(contents).toContain('raw-stderr-line')
    expect(contents).toContain('log-line')
    expect(contents).toContain('warn-line')
    expect(contents).toContain('error-line')
    expect(contents).toContain('info-line')
    expect(contents).toContain('debug-line')
    expect(contents).toContain('trace-line')

    restore()
    expect(console.log).toBe(originalLog)
    expect(console.warn).toBe(originalWarn)
    expect(console.error).toBe(originalError)
    expect(console.info).toBe(originalInfo)
    expect(console.debug).toBe(originalDebug)
    expect(console.trace).toBe(originalTrace)
  })

  it('restore() is idempotent — calling it twice does not throw', () => {
    dir = mkdtempSync(join(tmpdir(), 'zeal-stdio-'))
    const logPath = join(dir, 'zeal.log')
    const restore = redirectDiagnostics(logPath)
    restoreAfter = restore
    console.log('once')
    restore()
    expect(() => restore()).not.toThrow()
  })

  it('a write through the captured patched sink after restore() is a no-op, not an EBADF throw', () => {
    dir = mkdtempSync(join(tmpdir(), 'zeal-stdio-'))
    const logPath = join(dir, 'zeal.log')
    const restore = redirectDiagnostics(logPath)
    restoreAfter = restore
    // A dependency may capture the patched writer while the redirect is live…
    const captured = process.stderr.write.bind(process.stderr)
    restore()
    // …and call it after restore() closed the log fd. That must not throw.
    expect(() => captured('late-line\n')).not.toThrow()
    expect(readFileSync(logPath, 'utf8')).not.toContain('late-line')
  })
})
