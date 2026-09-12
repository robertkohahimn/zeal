#!/usr/bin/env node
import { createRequire } from 'node:module'
import { readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const ZEAL_PROFILE = 'zeal'
const ZEAL_PLUGIN = '@zealagent/dsh-zeal'
const RUNTIME_WORKER_PLUGIN = '@deepseek-ai/dsh-code-runtime-worker-thread'

export interface BootstrapPlan {
  needsInit: boolean
  installArgs: string[]
  launchArgs: string[]
}

export interface ProfileManifest {
  dependencies?: Record<string, string>
}

export interface PlanBootstrapOptions {
  dshHome: string
  profileManifest?: ProfileManifest | undefined
  argv: string[]
}

/**
 * Pure planning core: decides whether the zeal dsh profile needs to be
 * bootstrapped and builds the argv for both the (optional) install step and
 * the launch step. Filesystem-free by design — callers read the profile
 * manifest and pass it in as data.
 */
export function planBootstrap(opts: PlanBootstrapOptions): BootstrapPlan {
  const { profileManifest, argv } = opts
  const hasZealDependency = Boolean(profileManifest?.dependencies?.[ZEAL_PLUGIN])
  const needsInit = !hasZealDependency

  return {
    needsInit,
    installArgs: ['plugin', '--profile', ZEAL_PROFILE, 'add', ZEAL_PLUGIN, RUNTIME_WORKER_PLUGIN],
    launchArgs: ['--profile', ZEAL_PROFILE, ...argv],
  }
}

/**
 * Resolves the path to the dsh CLI's binary executable by inspecting the
 * installed @deepseek-ai/dsh package's `bin` field (which may be a string or
 * an object mapping bin names to paths).
 */
export function resolveDshBin(): string {
  const require = createRequire(import.meta.url)
  const dshPackageJsonPath = require.resolve('@deepseek-ai/dsh/package.json')
  const dshPackageDir = dirname(dshPackageJsonPath)
  const dshPackageJson = JSON.parse(readFileSync(dshPackageJsonPath, 'utf8')) as {
    bin?: string | Record<string, string>
  }

  const binField = dshPackageJson.bin
  const relativeBinPath = typeof binField === 'string' ? binField : binField?.dsh

  if (!relativeBinPath) {
    throw new Error('Could not resolve dsh bin path from @deepseek-ai/dsh package.json')
  }

  return join(dshPackageDir, relativeBinPath)
}

/** The subset of `SpawnSyncReturns` that the install-outcome decision needs. */
export interface SpawnOutcome {
  status: number | null
  error?: Error | undefined
}

/**
 * Pure decision: whether the launch step should proceed given the outcome
 * of the install step. Any spawn-level error, or a non-zero/null exit
 * status, blocks the launch — only a clean `status === 0` allows it.
 */
export function shouldLaunch(installOutcome: SpawnOutcome): boolean {
  return !installOutcome.error && installOutcome.status === 0
}

/** Resolves an exit code to report/exit with for a failed install outcome. */
function installExitCode(installOutcome: SpawnOutcome): number {
  return installOutcome.error ? 1 : (installOutcome.status ?? 1)
}

function getDshHome(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

function readProfileManifest(dshHome: string): ProfileManifest | undefined {
  const manifestPath = join(dshHome, 'profiles', ZEAL_PROFILE, 'package.json')
  try {
    const raw = readFileSync(manifestPath, 'utf8')
    return JSON.parse(raw) as ProfileManifest
  } catch {
    return undefined
  }
}

export function main(argv: string[] = process.argv.slice(2)): void {
  const dshHome = getDshHome()
  const profileManifest = readProfileManifest(dshHome)
  const plan = planBootstrap({ dshHome, profileManifest, argv })
  const dshBin = resolveDshBin()

  if (plan.needsInit) {
    const installResult = spawnSync(process.execPath, [dshBin, ...plan.installArgs], {
      stdio: 'inherit',
    })
    if (!shouldLaunch(installResult)) {
      const exitCode = installExitCode(installResult)
      const reason = installResult.error ? installResult.error.message : `exit code ${exitCode}`
      process.stderr.write(`zeal: failed to install the zeal dsh profile (${reason})\n`)
      process.exit(exitCode)
    }
  }

  const child = spawnSync(process.execPath, [dshBin, ...plan.launchArgs], { stdio: 'inherit' })
  // Mirror the install step's failure reporting: `status` is null when the
  // child never ran (spawn error) or died on a signal, and exiting 1 with no
  // message would hide the cause — the same silent-failure class the
  // symlink-blind main-module guard fix addressed.
  if (child.error) {
    process.stderr.write(`zeal: failed to launch dsh (${child.error.message})\n`)
  } else if (child.signal !== null) {
    process.stderr.write(`zeal: dsh was terminated by signal ${child.signal}\n`)
  }
  process.exit(child.status ?? 1)
}

/**
 * True when this module was invoked directly as the process entry point
 * (`node main.js …`), as opposed to merely being imported.
 *
 * `import.meta.url` is realpath'd by Node's ESM loader before this module's
 * top-level code ever runs (Node resolves symlinks while loading an ES
 * module unless `--preserve-symlinks` is passed), but `process.argv[1]` is
 * NOT — it is whatever path the OS invoked, verbatim. `npm`/`pnpm` install a
 * package's `bin` entry as a symlink under `node_modules/.bin`, so `npx
 * @zealagent/zeal` (or a global install) launches this file through exactly
 * such a symlink: `import.meta.url` becomes the real `lib/main.js` path
 * while `process.argv[1]` stays the `.bin/zeal` symlink path. A direct
 * string/URL comparison between the two then never matches, so `isMainModule`
 * evaluated `false`, `main()` was never called, and the process exited 0
 * having silently done nothing — no error, no output, just an inert launcher.
 * `realpathSync` here resolves the symlink on the `argv[1]` side too, so the
 * comparison is symlink-invariant either way. Wrapped in try/catch because a
 * nonexistent/unreadable `argv[1]` (unusual, but not this module's problem to
 * crash on) should fall back to the raw path rather than throw before `main`
 * ever gets a chance to run.
 */
function resolveMainModulePath(argvPath: string): string {
  try {
    return realpathSync(argvPath)
  } catch {
    return argvPath
  }
}

const isMainModule = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolveMainModulePath(process.argv[1] as string)).href
if (isMainModule) {
  main()
}
