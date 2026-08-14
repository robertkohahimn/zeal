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
async function wireDriverObservers(ctx: Context, store: ZealStore, driver: ZealDriver): Promise<void> {
  const session = driver.agent.session
  const sandboxPolicy = ctx.get('sandboxPolicy') as { resolve?: (req: { session: unknown }) => { mode?: string } } | undefined
  const policy = await sandboxPolicy?.resolve?.({ session })
  if (policy?.mode !== undefined) store.setStatus({ sandboxMode: policy.mode })

  driver.agent.ctx.on('session/event', (_session: unknown, event: SessionEvent) => {
    const zealEvent = normalizeEvent(event)
    if (zealEvent.t !== 'turn-end') return

    if (zealEvent.outcome === 'error' && zealEvent.errorCode === 'MISSING_CREDENTIAL') {
      store.addNotice('error', onboardingNotice(store.getState().status.provider))
    }

    const sessionTitle = ctx.get('sessionTitle') as { get?: (s: unknown) => { title?: string } | undefined } | undefined
    const snapshot = sessionTitle?.get?.(session)
    if (snapshot?.title !== undefined) store.setStatus({ title: snapshot.title })
  })
}

/**
 * The plugin entry point. Kicks off the async boot sequence and returns
 * immediately — Cordis plugin `apply()` is synchronous by contract, and the
 * boot work (loader await, agent creation, Ink mount) is all inherently
 * asynchronous.
 */
export function apply(ctx: Context, config: Config): void {
  const logPath = config.logFile ?? defaultLogPath()
  const restoreStdio = redirectDiagnostics(logPath)
  void bootZealTui(ctx, restoreStdio)
}

/**
 * Sequence (per the brief): redirect diagnostics (done by `apply` before
 * this call) → build store → start driver → register answerers → mount
 * Ink (`exitOnCtrlC: false, patchConsole: false`) → on quit: unmount, await
 * `driver.flush()`, restore stdio, `ctx.appExit(0)`.
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

    /** `/resume` restart: dispose the retiring driver (carry-forward 3), start the replacement, rebuild its dispatcher/observers. */
    async function handleResume(sessionId: string): Promise<{ driver: AppDriver; dispatcher: CommandDispatcher }> {
      await driver.dispose()
      driver = await ZealDriver.start(ctx, store, { resumeSessionId: sessionId })
      dispatcher = buildDispatcher(ctx, driver, () => handleQuit())
      await wireDriverObservers(ctx, store, driver)
      return { driver, dispatcher }
    }

    let quitting = false
    let instance: Instance | undefined

    function handleQuit(): void {
      void quit()
    }

    async function quit(): Promise<void> {
      if (quitting) return
      quitting = true
      instance?.unmount()
      await driver.flush()
      restoreStdio()
      ctx.appExit?.(0)
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
