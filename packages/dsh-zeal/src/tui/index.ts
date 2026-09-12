/**
 * The `zeal-tui` Cordis plugin: the mounted assembly of every prior Zeal TUI
 * component. `apply()` follows the brief's exact sequence — redirect
 * diagnostics, build the store, start the driver, register the interactive
 * answerers, mount Ink — and stays thin by delegating to the small
 * independently-testable pieces below (`onboardingNotice`, `defaultLogPath`,
 * `buildDispatcher`, `wireDriverObservers`). `apply()` itself is
 * integration-verified later (Task 16 boots the whole bundle); this module's
 * unit tests cover the pure pieces directly.
 *
 * TYPE AUGMENTATION NOTE: `ctx.commands`, `ctx.appExit`, and `ctx.zealStartup`
 * are declared via `declare module '@deepseek-ai/cordis'` blocks inside
 * `@deepseek-ai/dsh-commands`, `@deepseek-ai/dsh-cmdline`, and this package's
 * own `../startup.ts` respectively. None of those three properties were
 * previously dot-accessed anywhere in this package's `src/`, so the
 * type-only imports below exist SOLELY to pull their augmentations into this
 * file's compilation (mirrors `driver.ts`'s own `import type {} from
 * '@deepseek-ai/dsh-agent-default-model'` precedent). `sandboxPolicy` and
 * `sessionTitle` need no such import: neither package is a dependency of
 * this one (they are genuinely optional peers), so `ctx.get('sandboxPolicy'
 * | 'sessionTitle')` resolves through `ReflectService`'s untyped
 * `get(name: string): any` overload — exactly the `ctx.get('loader')`
 * pattern `driver.ts` already uses for another optional service.
 * @module @zealagent/dsh-zeal/tui
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { render } from 'ink'
import type { Instance } from 'ink'
import { createElement } from 'react'
// Type-only imports whose sole purpose is pulling in a Context augmentation — see the module doc.
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-cmdline'
import type {} from '@deepseek-ai/dsh-commands'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { registerZealAnswerers } from './answerers.ts'
import { CommandDispatcher, helpText } from './commands.ts'
import type { LocalCommand } from './commands.ts'
import { ZealDriver } from './driver.ts'
import { normalizeEvent } from './normalize.ts'
import { ZealStore } from './store.ts'
import { redirectDiagnostics } from './stdio.ts'
import type {} from '../startup.ts'
import { App } from './ui/App.tsx'
import type { AppDriver } from './ui/App.tsx'

export const name = 'zeal-tui'
export const inject = [
  'agents',
  'agentDefaultModel',
  'sessions',
  'userQuestions',
  'commands',
  'sessionQuery',
  'cmdlineArgs',
  'appExit',
  'zealStartup',
]

export interface Config { logFile?: string }
export const Config: z<Config> = z.object({ logFile: z.string() })

/** `DSH_HOME` (default `~/.dsh`)'s conventional per-profile log path — see this task's doc for why it lives under `profiles/zeal/logs`. */
export function defaultLogPath(): string {
  const dshHome = process.env['DSH_HOME'] ?? join(homedir(), '.dsh')
  return join(dshHome, 'profiles', 'zeal', 'logs', 'zeal.log')
}

/**
 * Zeal ships exactly two GLM routes (`cordis.patch.yml`'s `llm-pi-ai`
 * config): `zai` → `ZAI_API_KEY`, `zai-coding-cn` → `ZHIPU_API_KEY`. This is
 * static Zeal-authored knowledge, not a runtime read of provider row
 * config — the design spec's §3.6 "the TUI never reads provider row config
 * to guess credential names" rules out introspecting `cordis.patch.yml`/
 * `settings.yaml` at runtime, not knowing Zeal's own fixed two-route map.
 */
const CREDENTIAL_ENV_BY_ROUTE: Record<string, string> = {
  zai: 'ZAI_API_KEY',
  'zai-coding-cn': 'ZHIPU_API_KEY',
}

/**
 * The exact onboarding text this task's brief specifies for a
 * `MISSING_CREDENTIAL` turn-end error on `route`. Pure and exported for
 * direct unit testing — the raw `session/event` listener that decides WHEN
 * to show it (`wireDriverObservers`) is integration-verified later.
 * @param route - the provider route the failing request used (`store`'s
 *   `status.provider` at the time of the error — the best available signal,
 *   since `LlmFailure`/`ZealEvent`'s turn-end carry no route field of their
 *   own; see this task's report for why).
 */
export function onboardingNotice(route: string): string {
  const env = CREDENTIAL_ENV_BY_ROUTE[route] ?? `${route}'s API key`
  return (
    `No API key found for the ${route} route. Set ${env} in your environment ` +
    'or add it to $DSH_HOME/.credentials.yaml, then retry. (A key configured ' +
    'in $DSH_HOME/settings.yaml under llm-pi-ai: also works.)'
  )
}

/**
 * Build the four driver-local commands (`commands.ts`'s module doc:
 * `/model`, `/resume`, `/help`, `/quit`) bound to one live `driver`, plus the
 * `CommandDispatcher` that merges them with the `ctx.commands` seam. Called
 * once at initial boot and again after every `/resume` restart (a fresh
 * driver needs fresh locals — reusing the old dispatcher's `/model` would
 * silently keep operating on the disposed driver it closed over).
 *
 * `/resume`'s own `run()` here is a deliberate stub: `App.tsx`'s module doc
 * explains why the INTERACTIVE picker flow is intercepted by `App` itself
 * before dispatch ever reaches this local (only React can render the
 * picker) — this entry exists so `/resume` still appears in `/help` and
 * tab-completion, and so a line that somehow reaches `dispatch()` for it
 * (never happens through `App`'s normal submit path) still says something
 * sane instead of falling through to the seam as an unknown command.
 */
function buildDispatcher(ctx: Context, driver: ZealDriver, onQuit: () => void): CommandDispatcher {
  const dispatcherHolder: { current?: CommandDispatcher } = {}
  const locals: LocalCommand[] = [
    {
      name: 'help',
      description: 'List available commands',
      run: async () => helpText(dispatcherHolder.current!),
    },
    {
      name: 'quit',
      description: 'Quit Zeal',
      run: async () => {
        onQuit()
        return undefined
      },
    },
    {
      name: 'model',
      description: 'Switch the active model (usage: /model <id> [provider])',
      run: async (input) => {
        const [model, provider] = input.trim().split(/\s+/).filter((part) => part.length > 0)
        if (model === undefined) return 'Usage: /model <id> [provider]'
        driver.switchModel(model, provider)
        return provider === undefined ? `Switched to model ${model}.` : `Switched to model ${model} (${provider}).`
      },
    },
    {
      name: 'resume',
      description: 'Resume a persisted session (run without an id to pick interactively)',
      run: async () => 'Use /resume for the interactive picker, or /resume <session-id> directly.',
    },
  ]
  // `ctx.commands` (the real `CommandService`) is assigned directly as the
  // structural `CommandSeam` — carry-forward 2's exact verification point.
  // `commands.ts`'s own module doc documents why this typechecks: `list`/
  // `execute` are declared with method-shorthand syntax on both sides, so
  // TypeScript compares their parameter types bivariantly (`Agent`/`unknown`
  // and required-`signal`/optional-`signal` both pass under that relaxed
  // check) rather than under `strictFunctionTypes`' stricter arrow-property
  // variance, which a property-typed version of the same seam shape fails.
  const dispatcher = new CommandDispatcher({ seam: ctx.commands, agent: driver.agent, locals })
  dispatcherHolder.current = dispatcher
  return dispatcher
}

/**
 * Wire the per-driver observers the brief's `apply()` sketch calls for:
 * a one-time sandbox-mode status read, and a `session/event` listener that
 * polls the session title after each turn-end and raises the onboarding
 * notice on a `MISSING_CREDENTIAL` turn-end error. Registered once at
 * initial boot and again after every `/resume` restart (the retiring
 * driver's listener dies with its disposed agent scope; the new driver gets
 * its own).
 * @param ctx - the plugin context (`sandboxPolicy`/`sessionTitle` are read
 *   optionally through `ctx.get`, per the brief — see the module doc's type note).
 * @param store - the transcript store notices/status land on.
 * @param driver - the live driver whose agent's `session/event` firehose is observed.
 */
export async function wireDriverObservers(ctx: Context, store: ZealStore, driver: ZealDriver): Promise<void> {
  const session = driver.agent.session
  const sandboxPolicy = ctx.get('sandboxPolicy') as { resolve?: (req: { session: unknown }) => { mode?: string } } | undefined
  // I8 fix (final-review fix wave): this is a purely cosmetic status-bar
  // read. `wireDriverObservers` runs inside `bootZealTui`'s outer try/catch
  // (initial boot) and inside `resumeDriver` (a `/resume` restart) — left
  // unguarded, a rejecting/throwing optional service here would be
  // indistinguishable from a genuine boot/resume failure and abort the
  // whole TUI over nothing worse than a missing sandbox-mode label.
  try {
    const policy = await sandboxPolicy?.resolve?.({ session })
    if (policy?.mode !== undefined) store.setStatus({ sandboxMode: policy.mode })
  } catch (err) {
    console.error('zeal-tui: sandboxPolicy.resolve() failed (ignored — status-bar cosmetic only):', err)
  }

  driver.agent.ctx.on('session/event', (_session: unknown, event: SessionEvent) => {
    const zealEvent = normalizeEvent(event)
    if (zealEvent.t !== 'turn-end') return

    if (zealEvent.outcome === 'error' && zealEvent.errorCode === 'MISSING_CREDENTIAL') {
      store.addNotice('error', onboardingNotice(store.getState().status.provider))
    }

    // I8 fix: same reasoning as above. A `session/event` listener that
    // throws can break the emitting call site's own control flow (an
    // ordinary `EventEmitter` does not isolate listener exceptions) — a
    // throwing `sessionTitle.get()` must never be allowed to do that over a
    // purely cosmetic status-bar read.
    try {
      const sessionTitle = ctx.get('sessionTitle') as { get?: (s: unknown) => { title?: string } | undefined } | undefined
      const snapshot = sessionTitle?.get?.(session)
      if (snapshot?.title !== undefined) store.setStatus({ title: snapshot.title })
    } catch (err) {
      console.error('zeal-tui: sessionTitle.get() failed (ignored — status-bar cosmetic only):', err)
    }
  })
}

/**
 * `/resume` restart, factored out of `bootZealTui` so it is directly
 * unit-testable (an "assembly-level" test per this task's review) without
 * mounting Ink — it only needs `ctx`/`store`/a live `ZealDriver`, exactly
 * the fidelity level `tests/driver.test.ts` already exercises `ZealDriver`
 * at.
 *
 * ORDERING (I4 fix, final-review fix wave — supersedes the Task 14 review's
 * original CRITICAL fix, which had the retiring driver disposed and the
 * store reset BEFORE the replacement `ZealDriver.start()`): if that
 * replacement `start()` rejects (e.g. `/resume` of a session id that no
 * longer exists), disposing/resetting first left the TUI wired to an
 * already-disposed driver over an already-wiped transcript — a start
 * FAILURE destroyed the still-working session. The chosen order here:
 *
 *   1. `ZealDriver.start()` the REPLACEMENT first, touching neither the
 *      retiring driver nor `store`'s reset state. If this rejects,
 *      `resumeDriver` simply rejects too — the retiring driver is never
 *      disposed and `store` is never reset, so the TUI is left exactly as
 *      it was (`App.tsx`'s `performResume` catch renders the rejection as
 *      an error notice over the still-intact, still-live session).
 *   2. Only once `start()` has SUCCEEDED: dispose the retiring driver, then
 *      `store.reset(...)` (bumping `state.generation` — see `store.ts`'s and
 *      `model.ts`'s doc comments for why `Transcript.tsx` needs that to
 *      remount `<Static>` correctly here).
 *   3. Re-apply the resumed session's full event log — `driver.agent.
 *      session.events` — into the now-reset `store`.
 *
 * Why step 3 is necessary despite `ZealDriver.start()` already having fed
 * the same seed (and any live events from its own await window) into
 * `store` once during step 1: at that point `store.lastSeq` was still the
 * RETIRING session's high-water mark, and the resumed session's seed has its
 * own independent, typically much LOWER `seq` counter — `ZealStore.apply`'s
 * `seq <= lastSeq` guard silently drops it as indistinguishable from stale
 * replay (the exact CRITICAL-1 failure mode the original fix targeted).
 * That is fine and expected here, not a bug: whatever transiently happened
 * to `store` during step 1 is unconditionally wiped by step 2's `reset()`
 * moments later. Step 3 re-applies from `driver.agent.session.events` —
 * which, being the session's own append-only log, already reflects BOTH the
 * original seed AND any live events that arrived during step 1's await
 * window — against the freshly reset guard (`lastSeq` back to `-1`), so this
 * single replay recovers exactly the correct state with nothing missing and
 * nothing duplicated.
 * @param ctx - the plugin context.
 * @param store - the ONE store instance reused across the restart.
 * @param retiringDriver - the driver being replaced; disposed only after the replacement successfully starts.
 * @param sessionId - the persisted session id to resume.
 * @param onQuit - forwarded into the fresh dispatcher's `/quit` local.
 * @returns the fresh driver and dispatcher `App`/`bootZealTui` swap in.
 * @throws whatever `ZealDriver.start()` throws — the retiring driver and `store` are left untouched in that case (see the ordering note above).
 */
export async function resumeDriver(
  ctx: Context,
  store: ZealStore,
  retiringDriver: ZealDriver,
  sessionId: string,
  onQuit: () => void,
): Promise<{ driver: ZealDriver; dispatcher: CommandDispatcher }> {
  // Step 1: start the replacement FIRST. A rejection here propagates
  // straight out of `resumeDriver` without touching `retiringDriver` or
  // `store` at all — see the ordering note above.
  const driver = await ZealDriver.start(ctx, store, { resumeSessionId: sessionId })

  // Step 2: only now, with the replacement live, retire the old driver and
  // reset the store for the new session.
  await retiringDriver.dispose()
  const defaultSelection = ctx.agentDefaultModel.currentSelection()
  // `defaultSelection` is a reasonable initial status for the resumed
  // session — the first `request/header` event in the replay below (or a
  // later live one) corrects it if the resumed session actually used a
  // different route/model.
  store.reset({ provider: defaultSelection.provider, model: defaultSelection.model })

  // Step 3: re-apply the resumed session's full event log against the
  // now-reset guard — see the ordering note above for why this (not the
  // apply attempt already made inside step 1's `ZealDriver.start()`) is the
  // replay that actually lands.
  for (const event of driver.agent.session.events) store.apply(event)

  const dispatcher = buildDispatcher(ctx, driver, onQuit)
  await wireDriverObservers(ctx, store, driver)
  return { driver, dispatcher }
}

/** Bounded wait: races `promise` against a `ms` timeout, resolving `undefined` (never rejecting) if either the timeout wins or `promise` itself rejects. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      resolve(undefined)
    }, ms)
    timer.unref?.()
    promise.then(
      (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      },
      () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(undefined)
      },
    )
  })
}

/**
 * How long `performQuit` waits for `driver.agent.whenIdle()` after
 * `interrupt()` before giving up and flushing anyway (IMPORTANT 3, Task 14
 * review). A pragmatic v1 choice, not derived from any measured p99: long
 * enough to let an in-flight tool call or the last few streamed tokens wrap
 * up cleanly after `interrupt()` cancels the turn (so the durable log ends
 * on a settled boundary rather than mid-stream), short enough that quitting
 * on a truly stuck agent doesn't make double-Ctrl+C feel broken/hung.
 * Deliberately not configurable — revisit with real usage data if it proves
 * mistuned in either direction.
 */
export const QUIESCE_TIMEOUT_MS = 2000

/** Structural subset of `ZealDriver` `performQuit` needs — kept narrow so its tests don't need a full `ZealDriver.start()`. */
export interface QuitDriver {
  interrupt(): void
  flush(): Promise<void>
  agent: { whenIdle(): Promise<void> }
}

export interface QuitDeps {
  /** Unmount the Ink tree. A thunk (not the `Instance` itself) so a caller can defer to whatever `instance` currently holds. */
  unmount(): void
  driver: QuitDriver
  restoreStdio(): void
  /** `ctx.appExit` is itself optional on `Context` (`@deepseek-ai/dsh-cmdline`'s augmentation) — this mirrors that, called only if present. */
  appExit: ((code: number) => void) | undefined
}

/**
 * The on-quit sequence (per the brief, hardened per Task 14's review):
 * unmount → interrupt the active turn and wait (bounded by
 * `QUIESCE_TIMEOUT_MS`) for the agent to quiesce → flush → restore stdio →
 * `appExit(0)`.
 *
 * IMPORTANT 2 fix: `restoreStdio`/`appExit` now run from a `finally`, so a
 * rejecting `flush()` (or a `whenIdle()` that somehow rejects instead of
 * just timing out) can never leave the process stuck mid-quit with stdio
 * still redirected and no exit requested. The failure itself is logged
 * (`console.error`) BEFORE `restoreStdio()` runs, while diagnostics are
 * still redirected to the log file — logging after restore would send it to
 * the now-torn-down terminal instead.
 *
 * IMPORTANT 3 fix: `driver.interrupt()` + a bounded `driver.agent.whenIdle()`
 * wait now run before `flush()`, so the durable session log reflects a
 * settled turn boundary rather than whatever was mid-flight when the user
 * quit.
 *
 * M9 fix (final-review fix wave): `deps.unmount()` now runs INSIDE the same
 * try/finally as `interrupt`/`whenIdle`/`flush`, not before it. Previously a
 * throwing `unmount()` (Ink's own teardown is not guaranteed exception-free)
 * would throw straight out of `performQuit` before the `finally` block ever
 * ran, leaving `restoreStdio()`/`appExit` uncalled — stdio stuck redirected
 * and no exit requested, the exact stuck-mid-quit failure mode IMPORTANT 2
 * already fixed for `flush()`/`whenIdle()`, just not yet for `unmount()`.
 * @param deps - the driver and lifecycle callbacks this sequence drives.
 * @param quiesceTimeoutMs - override for `QUIESCE_TIMEOUT_MS` (tests only).
 */
export async function performQuit(deps: QuitDeps, quiesceTimeoutMs: number = QUIESCE_TIMEOUT_MS): Promise<void> {
  try {
    deps.unmount()
    deps.driver.interrupt()
    await withTimeout(deps.driver.agent.whenIdle(), quiesceTimeoutMs)
    await deps.driver.flush()
  } catch (err) {
    console.error('zeal-tui: quiesce/flush before quit failed:', err)
  } finally {
    deps.restoreStdio()
    deps.appExit?.(0)
  }
}

/**
 * The POST-MOUNT crash counterpart to `performQuit`: same quiesce → flush →
 * restore-stdio sequence, but it reports `err` and exits NONZERO (spec §3.5:
 * "If the TUI throws: print a plain-text error, flush sessions, exit
 * nonzero").
 *
 * Needed because `bootZealTui`'s try/catch only covers the SYNCHRONOUS
 * `render()` call. Once Ink has mounted, a React error-boundary failure is
 * reported by Ink calling `unmount(error)`, which rejects the promise from
 * `instance.waitUntilExit()` — not by throwing anywhere `bootZealTui` can
 * see. Ink suppresses the global unhandled-rejection warning for that
 * promise internally, so without an explicit rejection handler a crashed
 * render is completely silent: the driver keeps running, stdio stays
 * redirected to the log file, and the process never exits nonzero.
 *
 * `deps.unmount()` is still called (inside the try, per `performQuit`'s M9
 * rationale) even though Ink has already torn itself down on this path —
 * Ink's own `unmount` is a no-op once unmounted, and routing every exit
 * through the same sequence keeps the two paths from drifting.
 *
 * The error is printed AFTER `restoreStdio()` so it reaches the real
 * terminal rather than the diagnostics log the TUI redirected stdio into —
 * the same ordering `bootZealTui`'s pre-mount catch already uses.
 * @param deps - the driver and lifecycle callbacks this sequence drives.
 * @param err - the post-mount failure to report.
 * @param quiesceTimeoutMs - override for `QUIESCE_TIMEOUT_MS` (tests only).
 */
export async function performCrashExit(
  deps: QuitDeps,
  err: unknown,
  quiesceTimeoutMs: number = QUIESCE_TIMEOUT_MS,
): Promise<void> {
  try {
    deps.unmount()
    deps.driver.interrupt()
    await withTimeout(deps.driver.agent.whenIdle(), quiesceTimeoutMs)
    await deps.driver.flush()
  } catch (cleanupErr) {
    console.error('zeal-tui: quiesce/flush after render failure failed:', cleanupErr)
  } finally {
    deps.restoreStdio()
    console.error('zeal-tui crashed:', err)
    deps.appExit?.(1)
  }
}

/** The exact plain-text message M11 (final-review fix wave) specifies for a non-TTY boot attempt. */
export const NON_TTY_MESSAGE = 'zeal requires an interactive terminal (TTY)'

/**
 * M11 boot precondition: Ink puts the terminal into raw mode to own
 * keyboard input (spec §3.5), which requires a REAL interactive TTY on both
 * `stdin` and `stdout`. A piped/non-interactive invocation (CI, a script, a
 * redirected `dsh --profile zeal < input.txt`) cannot be made to work — Ink's
 * own raw-mode setup would fail deep inside `render()` with a much less
 * legible error, or hang. Parameterized over the streams (rather than
 * reading `process.stdout`/`process.stdin` directly) so tests can exercise
 * both outcomes without touching this process's real stdio.
 * @param streams - `isTTY` from `process.stdout`/`process.stdin`.
 * @returns `true` only when both streams report an interactive TTY.
 */
export function isInteractiveTty(streams: { stdout: { isTTY?: boolean }; stdin: { isTTY?: boolean } }): boolean {
  return Boolean(streams.stdout.isTTY) && Boolean(streams.stdin.isTTY)
}

/**
 * The plugin entry point. Kicks off the async boot sequence and returns
 * immediately — Cordis plugin `apply()` is synchronous by contract, and the
 * boot work (loader await, agent creation, Ink mount) is all inherently
 * asynchronous.
 *
 * M11 fix: the TTY check runs FIRST, before `redirectDiagnostics` runs at
 * all — this is the "restore stdio first if already redirected" concern
 * satisfied by construction rather than by an extra runtime call: writing
 * `NON_TTY_MESSAGE` to the real `process.stderr` only reaches the terminal
 * before `redirectDiagnostics` patches `process.stderr.write` to append to
 * the diagnostics log file instead — after that patch, the very message
 * meant to explain the failure to the user would silently vanish into a log
 * file nobody is looking at. Ordering the check first means there is never
 * anything to restore.
 */
export function apply(ctx: Context, config: Config): void {
  if (!isInteractiveTty({ stdout: process.stdout, stdin: process.stdin })) {
    process.stderr.write(`${NON_TTY_MESSAGE}\n`)
    ctx.appExit?.(1)
    return
  }
  const logPath = config.logFile ?? defaultLogPath()
  const restoreStdio = redirectDiagnostics(logPath)
  void bootZealTui(ctx, restoreStdio)
}

/**
 * Sequence (per the brief): redirect diagnostics (done by `apply` before
 * this call) → build store → start driver → register answerers → mount
 * Ink (`exitOnCtrlC: false, patchConsole: false`) → on quit: `performQuit`
 * (unmount, quiesce, flush, restore stdio, `ctx.appExit(0)` — see its own
 * doc for the review hardening).
 *
 * Two distinct failure paths, because `render()` only throws for failures
 * that happen synchronously during the mount:
 *  - PRE-mount (anything up to and including `render()` returning) — the
 *    `catch` at the bottom of this function; nothing is mounted, so it just
 *    restores stdio, prints, and exits 1.
 *  - POST-mount (a React error boundary firing later) — the
 *    `waitUntilExit()` rejection handler, which routes into
 *    `performCrashExit` so the driver is still quiesced and flushed. See
 *    that function's doc for why Ink makes this the only observable signal.
 */
async function bootZealTui(ctx: Context, restoreStdio: () => void): Promise<void> {
  try {
    const defaultSelection = ctx.agentDefaultModel.currentSelection()
    const startup = ctx.zealStartup
    const initialModel = startup.model ?? defaultSelection.model
    const store = new ZealStore({ provider: defaultSelection.provider, model: initialModel })

    const initialOpts: { resumeSessionId?: string; model?: string } = {}
    if (startup.resumeSessionId !== undefined) initialOpts.resumeSessionId = startup.resumeSessionId
    if (startup.model !== undefined) initialOpts.model = startup.model

    let driver = await ZealDriver.start(ctx, store, initialOpts)
    // Call exactly once per bundle context (its own doc comment) — after the
    // first driver exists (answerers reference `store`, not any one driver)
    // and never again on a later `/resume` restart.
    registerZealAnswerers(ctx, store)

    let dispatcher = buildDispatcher(ctx, driver, () => handleQuit())
    await wireDriverObservers(ctx, store, driver)

    /** `/resume` restart — delegates to the standalone, unit-tested `resumeDriver`. */
    async function handleResume(sessionId: string): Promise<{ driver: AppDriver; dispatcher: CommandDispatcher }> {
      const next = await resumeDriver(ctx, store, driver, sessionId, () => handleQuit())
      driver = next.driver
      dispatcher = next.dispatcher
      return next
    }

    let quitting = false
    let instance: Instance | undefined

    function handleQuit(): void {
      // IMPORTANT 2/3 re-entry guard stays here (a stateful concern of this
      // closure); the actual sequence lives in the standalone `performQuit`.
      if (quitting) return
      quitting = true
      void performQuit({
        unmount: () => instance?.unmount(),
        driver,
        restoreStdio,
        appExit: ctx.appExit,
      })
    }

    // `createElement`, not JSX: this file is `.ts` (per the brief's file
    // list), and JSX syntax parses only in a `.tsx` file. `createElement(App,
    // props)` is exactly what `<App {...props} />` compiles down to, so this
    // mounts identically — critically, unlike calling `App(props)` directly
    // (which would invoke the component's hooks outside any React fiber and
    // crash), this defers execution to Ink's own render cycle.
    instance = render(
      createElement(App, { store, driver, dispatcher, onQuit: handleQuit, onResume: handleResume }),
      { exitOnCtrlC: false, patchConsole: false },
    )

    // Post-mount failures never reach the catch below (see
    // `performCrashExit`'s doc): Ink surfaces them by rejecting this
    // promise. `handleQuit`'s re-entry guard is reused so a crash arriving
    // during an in-flight quit does not run the teardown sequence twice.
    instance.waitUntilExit().catch((err: unknown) => {
      if (quitting) return
      quitting = true
      void performCrashExit({
        unmount: () => instance?.unmount(),
        driver,
        restoreStdio,
        appExit: ctx.appExit,
      }, err)
    })
  } catch (err) {
    // Spec §3.5: "If the TUI throws: print a plain-text error, flush
    // sessions, exit nonzero." Nothing mounted yet (or mounting itself
    // failed), so there is no App-level notice surface to use — stdio is
    // restored first so this print actually reaches the real terminal.
    restoreStdio()
    console.error('zeal-tui failed to start:', err)
    ctx.appExit?.(1)
  }
}
