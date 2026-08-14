import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
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
  process.exit(child.status ?? 1)
}

const isMainModule = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1] as string).href
if (isMainModule) {
  main()
}
