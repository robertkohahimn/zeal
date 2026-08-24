/**
 * Slash-command dispatcher: routes a `/`-prefixed input line to either a
 * driver-local command (Task 12/14: `/model`, `/resume`, `/help`, `/quit`)
 * or the `ctx.commands` seam (`@deepseek-ai/dsh-commands`), and merges both
 * sources for tab-completion and `/help` listing. Pure/portable — no Cordis
 * import, constructor-injected seam + agent + locals, fully testable with a
 * fake seam (see `tests/commands.test.ts`).
 *
 * TRANSCRIBED VOCABULARY. `CommandSeam` below is a deliberately structural
 * subset of the INSTALLED `@deepseek-ai/dsh-commands@0.0.1-rc.1` service
 * surface (`lib/types/index.d.ts` in that package), not an import of it —
 * this module and the assembly task pass the real `ctx.commands`/`Agent`
 * straight through. Corrections against this task's brief sketch (which
 * guessed `execute(...) => Promise<{ result?: { text?: string } } |
 * undefined>`):
 *
 *   - `list(agent: Agent): readonly CommandDescriptor[]` (index.d.ts:126) is
 *     SYNCHRONOUS, returning name-sorted `CommandDescriptor` (`{ name,
 *     description, input? }`, index.d.ts:67-74) — matches the brief.
 *   - `execute(agent: Agent, line: string, signal: AbortSignal):
 *     Promise<CommandExecution | undefined>` (index.d.ts:153). `undefined`
 *     means invalid syntax or unknown name, exactly as the brief says.
 *   - `CommandExecution` (index.d.ts:43-48) is `{ commandId: CommandId;
 *     result: CommandResult }` — `result` is NOT optional on a settled
 *     execution (the brief's `result?` was wrong); it is always present.
 *   - `CommandResult` (index.d.ts:28-36) is a discriminated union: `{ kind:
 *     'success'; text?: string; sourceEventSeq?: number } | { kind:
 *     'error'; text: string }`. Display text lives at `result.text` in
 *     both branches (optional on success, required on error) — the
 *     brief's `result.text?: string` guess was directionally right about
 *     *where* the text lives, just nested one level too shallow (`result?`
 *     vs `result`).
 *
 * `CommandSeam.execute`'s `signal` parameter is kept OPTIONAL here (unlike
 * the installed service's required `signal: AbortSignal`) so this
 * dispatcher's own `dispatch()` doesn't force every caller to supply an
 * `AbortSignal`. Declaring `list`/`execute` with method-shorthand syntax
 * (not arrow-typed properties) is deliberate: TypeScript checks method
 * parameters bivariantly, so the real `ctx.commands` (whose `execute`
 * requires a 3rd parameter) still structurally satisfies this narrower,
 * optional-3rd-parameter shape when the assembly task wires it in —
 * verified against a property-typed version of the same signature, which
 * `tsc --strict` rejects (`Type 'AbortSignal | undefined' is not
 * assignable to type 'AbortSignal'`).
 * @module @zealagent/dsh-zeal/tui/commands
 */

/** Structural mirror of the installed `CommandDescriptor` — only the fields this dispatcher reads. */
export interface CommandSeamDescriptor {
  name: string
  description: string
}

/** Structural mirror of the installed `CommandResult`'s two branches, collapsed to the one field this dispatcher surfaces. */
export interface CommandSeamResult {
  kind: 'success' | 'error'
  text?: string
}

/** Structural mirror of the installed `CommandExecution` — `result` is always present on a settled execution (see module doc's correction). */
export interface CommandSeamExecution {
  result: CommandSeamResult
}

/**
 * Structural subset of `ctx.commands` (`@deepseek-ai/dsh-commands`'s
 * `CommandService`). `agent` is `unknown` here — the real parameter type is
 * `Agent` from `@deepseek-ai/dsh-agent`, which this package must not import
 * to stay Cordis-free and independently testable.
 */
export interface CommandSeam {
  list(agent: unknown): ReadonlyArray<CommandSeamDescriptor>
  execute(agent: unknown, line: string, signal?: AbortSignal): Promise<CommandSeamExecution | undefined>
}

/** A driver-owned command handled entirely locally (`/model`, `/resume`, `/help`, `/quit`) — never reaches the seam. */
export interface LocalCommand {
  name: string
  description: string
  /** `input` is the exact text following the command name, including any separator whitespace — mirrors the seam's `rawInput` convention. Resolves to the UI text to display, or `undefined` for no output. */
  run(input: string): Promise<string | undefined>
}

/** Result of one `dispatch()` call. `uiText` is present only when there is text to show. */
export interface CommandOutcome {
  handled: boolean
  uiText?: string
}

/** One descriptor merged from locals and the seam, keyed by name — feeds both `completions()` and `helpText()`. */
interface MergedDescriptor {
  name: string
  description: string
}

function buildOutcome(handled: boolean, uiText?: string): CommandOutcome {
  return uiText === undefined ? { handled } : { handled, uiText }
}

/**
 * Split a `/`-prefixed line into its command name (lowercased, without the
 * slash) and the raw remainder (including separator whitespace, matching
 * the seam's `rawInput` convention). Does not enforce the seam's stricter
 * name-character grammar (`parseCommand()`'s `[a-z0-9_-]` + boundary rule)
 * — this split only decides LOCAL-name matching; a line that isn't a known
 * local is forwarded to the seam verbatim, which applies its own
 * authoritative grammar.
 */
function splitCommandLine(line: string): { name: string; rest: string } {
  const body = line.slice(1)
  const spaceIdx = body.search(/\s/)
  if (spaceIdx === -1) return { name: body.toLowerCase(), rest: '' }
  return { name: body.slice(0, spaceIdx).toLowerCase(), rest: body.slice(spaceIdx) }
}

/**
 * Routes a slash-command line to a local command or the `ctx.commands` seam.
 * Dispatch order is binding: a LOCAL name match always wins, even when the
 * seam exposes a same-named command — so `/model`, `/resume`, `/help`, and
 * `/quit` are never shadowed. Only when no local matches does the line go
 * to `seam.execute`; a seam `undefined` result (invalid syntax or unknown
 * name) becomes `{ handled: false }`.
 */
export class CommandDispatcher {
  private readonly seam: CommandSeam | undefined
  private readonly agent: unknown
  private readonly locals: readonly LocalCommand[]

  constructor(opts: { seam?: CommandSeam; agent?: unknown; locals: LocalCommand[] }) {
    this.seam = opts.seam
    this.agent = opts.agent
    this.locals = opts.locals
  }

  /** True when `line` starts with `/` (per the brief; does not otherwise validate command syntax). */
  isCommand(line: string): boolean {
    return line.startsWith('/')
  }

  /**
   * Merge locals and the seam's descriptors into one name-keyed list, a
   * local's entry winning over a same-named seam entry (mirroring
   * `dispatch`'s precedence), sorted by name. Backs both `completions()`
   * and `helpText()`.
   */
  private mergedDescriptors(): MergedDescriptor[] {
    const byName = new Map<string, MergedDescriptor>()
    if (this.seam) {
      for (const d of this.seam.list(this.agent)) byName.set(d.name, { name: d.name, description: d.description })
    }
    for (const l of this.locals) byName.set(l.name, { name: l.name, description: l.description })
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  /** Every merged command descriptor (locals winning name collisions), name-sorted. Used by `helpText`. */
  describe(): MergedDescriptor[] {
    return this.mergedDescriptors()
  }

  /** Merged, deduped, sorted `/name` completions whose text starts with `prefix` — case-insensitively, matching `dispatch`'s own lowercasing so `/Mo` completes the same commands `/Model` would dispatch. */
  completions(prefix: string): string[] {
    const lowered = prefix.toLowerCase()
    return this.mergedDescriptors()
      .map((d) => `/${d.name}`)
      .filter((n) => n.toLowerCase().startsWith(lowered))
  }

  /**
   * Dispatch one input line. Order: non-command lines short-circuit to
   * `{ handled: false }` without touching locals or the seam; a matching
   * local name always wins over the seam; otherwise the full line and
   * `signal` are forwarded to `seam.execute`, whose `undefined` result
   * becomes `{ handled: false }`.
   */
  async dispatch(line: string, signal?: AbortSignal): Promise<CommandOutcome> {
    if (!this.isCommand(line)) return buildOutcome(false)

    const { name, rest } = splitCommandLine(line)
    const local = this.locals.find((l) => l.name.toLowerCase() === name)
    if (local) {
      const uiText = await local.run(rest)
      return buildOutcome(true, uiText)
    }

    if (!this.seam) return buildOutcome(false)
    const execution = await this.seam.execute(this.agent, line, signal)
    if (execution === undefined) return buildOutcome(false)
    return buildOutcome(true, execution.result.text)
  }
}

/** Render a merged, name-sorted `/help` listing for `d`'s locals and seam commands. */
export function helpText(d: CommandDispatcher): string {
  const rows = d.describe()
  if (rows.length === 0) return 'No commands available.'
  return ['Available commands:', ...rows.map((r) => `  /${r.name} - ${r.description}`)].join('\n')
}
