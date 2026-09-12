/**
 * Zeal's command-line provider: it parses `--resume` and `--model`, then
 * publishes {@link ZealStartupValues} as the `zealStartup` service. Task 12's
 * driver and Task 14's assembly are the consumers.
 * @module @zealagent/dsh-zeal/startup
 */

import type { Context } from '@deepseek-ai/cordis'
import { Command } from 'commander'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis plugin name. */
export const name = 'zeal-startup'

/** Services required before startup values can be resolved. */
export const inject = ['cmdlineArgs']

/** What downstream rows read from the `zealStartup` service. */
export interface ZealStartupValues {
  /** A persisted session id to resume, when `--resume` was given. */
  resumeSessionId?: string
  /** The initial model id on the default route, when `--model` was given. */
  model?: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    zealStartup: ZealStartupValues
  }
}

/** Commander's parsed shape for Zeal's two flags. */
interface ZealOpts {
  resume?: string
  model?: string
}

/** Map commander's parsed options onto {@link ZealStartupValues}. */
function valuesFromOpts(opts: ZealOpts): ZealStartupValues {
  const values: ZealStartupValues = {}
  if (opts.resume !== undefined) values.resumeSessionId = opts.resume
  if (opts.model !== undefined) values.model = opts.model
  return values
}

/**
 * This app's command: the `--resume` and `--model` flags, their descriptions.
 * @returns a fresh program, so one process can parse more than once (tests).
 */
function zealCommand(): Command {
  return new Command('zeal')
    .option('--resume <sessionId>', 'resume a persisted session')
    .option('--model <id>', 'initial model id on the default route')
}

/**
 * Parse Zeal's startup flags out of a raw argument list. Pure and
 * Cordis-free so tests can exercise it directly: `exitOverride()` makes
 * commander throw instead of calling `process.exit` on `--help` or a parse
 * error, and `allowExcessArguments(false)` rejects stray positionals.
 * @param args - the raw arguments, in argv order.
 * @returns the parsed startup values.
 * @throws when an argument is unrecognized or otherwise invalid.
 */
export function parseZealArgs(args: string[]): ZealStartupValues {
  const program = zealCommand()
    .exitOverride()
    .allowExcessArguments(false)
  program.parse(args, { from: 'user' })
  return valuesFromOpts(program.opts<ZealOpts>())
}

/**
 * Parse and provide Zeal's startup values as an ordinary Cordis service.
 * Mirrors dsh-headless/startup: commander owns `--help` and parse errors,
 * `parseCmdline` binds the program to the launcher-provided argument snapshot
 * (`ctx.cmdlineArgs`) — never touch `process.argv` here. The action fires
 * after commander parsed that snapshot, so it reads `program.opts()`
 * directly.
 * @param ctx - plugin context carrying the command line.
 */
export function apply(ctx: Context): void {
  const program = zealCommand()
  program.action(() => {
    ctx.provide('zealStartup', valuesFromOpts(program.opts<ZealOpts>()))
  })
  parseCmdline(ctx, program)
}
