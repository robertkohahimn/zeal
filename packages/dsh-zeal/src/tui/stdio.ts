/**
 * Diagnostics redirect: while Ink owns the terminal (raw mode, its own
 * `stdout` writer), nothing else may write to `stdout`/`stderr` without
 * corrupting the rendered frame. `redirectDiagnostics` patches
 * `process.stderr.write` and every stdout/stderr-bound `console` method
 * (`log`/`warn`/`error`/`info`/`debug`/`trace`) so every diagnostic instead
 * lands in one append-only log file under the profile directory, and hands
 * back a restore function that undoes exactly that patch (used on quit,
 * before the terminal is handed back).
 *
 * Writes use the synchronous `fs` API (`writeSync` on an fd opened with
 * `'a'`) rather than a stream: diagnostics must never buffer past process
 * exit, and a sync write lets tests assert on file contents immediately
 * after a `console.error` call with no flush/await needed.
 *
 * The sink itself never throws: a dependency may capture the patched
 * `process.stderr.write` and call it after `restore()` closed the fd
 * (`EBADF`), and `writeSync` can fail transiently (`ENOSPC`, `EAGAIN`)
 * during normal operation — either would otherwise turn an arbitrary
 * `console.error` call site into a crash. A failed diagnostic write is
 * silently dropped instead; diagnostics are best-effort by definition.
 * @module @zealagent/dsh-zeal/tui/stdio
 */

import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs'
import { dirname } from 'node:path'
import { format } from 'node:util'

/** Node's `process.stderr.write` overload set — the exact signature this module intercepts and restores. */
type StreamWrite = typeof process.stderr.write

/** The stdout/stderr-bound `console` methods' shared signature. */
type ConsoleMethod = (...args: unknown[]) => void

/** The `console` methods this module patches — every one that writes to `stdout`/`stderr` by default. */
const CONSOLE_METHODS = ['log', 'warn', 'error', 'info', 'debug', 'trace'] as const

/**
 * Redirect `process.stderr.write` and the stdout/stderr-bound `console`
 * methods so their output is appended to `logPath` instead of reaching the
 * terminal. Creates `logPath`'s parent directory if it does not already
 * exist.
 * @param logPath - absolute path of the append-only diagnostics log.
 * @returns a restore function that undoes the redirect and closes the log fd. Idempotent — calling it more than once is a no-op after the first call.
 */
export function redirectDiagnostics(logPath: string): () => void {
  mkdirSync(dirname(logPath), { recursive: true })
  const fd = openSync(logPath, 'a')
  let closed = false

  const appendLine = (text: string): void => {
    if (closed) return
    // Never throws — see module doc comment.
    try {
      writeSync(fd, text.endsWith('\n') ? text : `${text}\n`)
    } catch {
      /* diagnostics are best-effort; a failed write is dropped */
    }
  }

  // Deliberately NOT `.bind()`-ed: these are saved only to be restored
  // verbatim (never invoked, since the patched versions below fully replace
  // rather than wrap them), so `restore()` can hand back the exact original
  // function reference — important because a caller may reasonably assert
  // `process.stderr.write === originalWrite` after restoring.
  const originalStderrWrite: StreamWrite = process.stderr.write
  const originalConsole: Record<(typeof CONSOLE_METHODS)[number], ConsoleMethod> = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
    debug: console.debug,
    trace: console.trace,
  }

  // `process.stderr.write` has two overloads (`(chunk, cb?)` and `(chunk,
  // encoding, cb?)`); the callback — whichever position it lands in — must
  // still fire so callers awaiting the write's completion are not left
  // hanging. The write itself is always synchronous here, so it is safe to
  // invoke the callback (if any) before returning.
  const patchedStderrWrite = ((chunk: unknown, encodingOrCb?: unknown, cb?: unknown): boolean => {
    const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('utf8')
    appendLine(text)
    const callback = typeof encodingOrCb === 'function' ? encodingOrCb : typeof cb === 'function' ? cb : undefined
    callback?.()
    return true
  }) as StreamWrite
  process.stderr.write = patchedStderrWrite

  for (const method of CONSOLE_METHODS) {
    console[method] = (...args: unknown[]): void => appendLine(format(...args))
  }

  let restored = false
  return () => {
    if (restored) return
    restored = true
    process.stderr.write = originalStderrWrite
    for (const method of CONSOLE_METHODS) {
      console[method] = originalConsole[method]
    }
    closed = true
    closeSync(fd)
  }
}
