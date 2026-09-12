/**
 * Real-harness composition helpers for Task 16's integration tests.
 *
 * IMPORTANT — never `exec` this workspace's own installed `@deepseek-ai/dsh`
 * copy directly: its real `bin.js` fails with `ERR_MODULE_NOT_FOUND` for
 * `@deepseek-ai/cordis-plugin-group`, a transitive dependency that this
 * workspace's `.npmrc` (`auto-install-peers=false`) and pnpm overrides
 * deliberately peer-block (see Task 15's carry-forward note in
 * `.superpowers/sdd/2026-08-14-zeal-implementation/progress.md`). Every
 * helper here instead shells out through `pnpm dlx @deepseek-ai/dsh@<pin>
 * <args>` — `dlx` resolves and materializes dsh's own complete,
 * self-consistent dependency closure in an isolated location, independent of
 * this workspace's install.
 * @module @zealagent/dsh-zeal/tests/composition/helpers
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

/** Pin matches the brief and Task 15's launcher (`@deepseek-ai/dsh@0.1.0-rc.6`). */
export const DSH_VERSION = '0.1.0-rc.6'

/** Absolute path to the bundle package (`packages/dsh-zeal`), regardless of cwd. */
const BUNDLE_DIR = fileURLToPath(new URL('../../', import.meta.url))

/** A single row of a `--dump-config` (or raw `cordis.patch.yml`) tree. */
export interface Row {
  id?: string
  name?: string
  disabled?: boolean
  config?: unknown
  insert?: Row[]
}

export interface ComposedProfile {
  /** `$DSH_HOME` for the fresh `zeal` profile — pass to `dumpConfig`. */
  dshHome: string
  /** Absolute path to the packed bundle tarball installed into the profile. */
  tarballPath: string
}

/**
 * YAML's default schema has no `!!js <expr>` tag (dsh-base's own patch rows
 * use it for computed values like `!!js process.cwd()`). Registering it as an
 * identity resolver keeps the *source expression* as a plain string instead
 * of throwing or evaluating it — evaluating would make results
 * machine/CWD-dependent, which would make the deliberate snapshot (Step 2b)
 * flaky across machines and runs.
 */
const JS_TAG = { tag: 'tag:yaml.org,2002:js', resolve: (value: string) => String(value) }

// `execFileSync`'s blocking wait is on the libuv/OS layer, outside the JS
// event loop — vitest's `testTimeout` can only observe it AFTER the call
// returns, so it cannot interrupt a hung child (e.g. a stalled registry
// fetch during `pnpm dlx`). Node's own `timeout`/`killSignal` options are
// honored by libuv itself and actually kill the child, so every
// `execFileSync` below sets them explicitly rather than relying on the
// vitest-level timeout as a backstop.
const BUILD_TIMEOUT_MS = 120_000
const DLX_TIMEOUT_MS = 300_000

function dlx(args: string[], dshHome: string): string {
  return execFileSync('pnpm', ['dlx', `@deepseek-ai/dsh@${DSH_VERSION}`, ...args], {
    env: { ...process.env, DSH_HOME: dshHome },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: DLX_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  })
}

// `pnpm run build` writes to this package's own, SHARED `lib/` directory
// (packages/dsh-zeal/lib) — not to any per-call tmp dir. vitest runs test
// files in parallel by default, and Tasks 17/18 add more test files that
// reuse `setupProfile`; two concurrent `tsdown` invocations racing on the
// same `lib/` output (one process's "Cleaning N files" landing mid another
// process's write) is a real hazard once more than one composition test
// file exists. Two mitigations, both cheap:
//  - in-process memoization: a given worker process builds at most once,
//    even if `setupProfile` is called more than once in it;
//  - `ZEAL_SKIP_BUILD=1`: an escape hatch for cross-process coordination —
//    build once up front (`pnpm --filter @zealagent/dsh-zeal run build`),
//    then run every gated composition file with `ZEAL_SKIP_BUILD=1` set so
//    no worker touches `lib/` again. The pack step is NOT memoized/guarded
//    this way: it writes into the caller's own `tmp` dir (unique per call,
//    confirmed below), so concurrent `pnpm pack` calls from different
//    workers never collide with each other.
let built = false

function buildBundle(): void {
  if (process.env['ZEAL_SKIP_BUILD']) {
    // The escape hatch promises the caller ALREADY built `lib/`. Verify that
    // rather than trusting it: `pnpm pack` does not fail on a missing "files"
    // glob, it just ships a tarball without one. Skipping the check would
    // turn a forgotten build into an empty bundle that installs cleanly and
    // then fails much later, deep inside the composed dsh boot, with an error
    // that says nothing about the real cause.
    if (!existsSync(join(BUNDLE_DIR, 'lib'))) {
      throw new Error(
        `ZEAL_SKIP_BUILD is set but ${join(BUNDLE_DIR, 'lib')} does not exist — ` +
          'build the bundle first (`pnpm --filter @zealagent/dsh-zeal run build`) or unset ZEAL_SKIP_BUILD.',
      )
    }
    return
  }
  if (built) return
  execFileSync('pnpm', ['run', 'build'], {
    cwd: BUNDLE_DIR,
    encoding: 'utf8',
    timeout: BUILD_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  })
  built = true
}

/**
 * Builds the bundle, packs it into `tmp`, creates a fresh `$DSH_HOME` under
 * `tmp`, and installs the packed tarball plus the code-runtime plugin into a
 * `zeal` profile there — all via the REAL `dsh` CLI (through `pnpm dlx`; see
 * the module doc).
 */
export function setupProfile(tmp: string): ComposedProfile {
  // lib/ must exist before `pnpm pack` — pack only ships what "files" globs
  // match on disk, it does not run the build script itself. See the
  // `buildBundle` doc above for why this is guarded rather than
  // unconditional.
  buildBundle()

  // `--pack-destination tmp` is the caller's own `mkdtempSync` directory
  // (unique per `setupProfile` call/test file), so the tarball's path never
  // collides across concurrent callers even though the package name+version
  // (and hence the tarball's basename) is the same for all of them.
  // `--ignore-scripts` suppresses the package's own `prepack` (which runs
  // the build): the build is `buildBundle`'s job here, guarded by the
  // memoization and the `ZEAL_SKIP_BUILD` escape hatch above. Letting
  // `prepack` fire would put an UNGUARDED `tsdown` behind every pack call
  // and reintroduce exactly the concurrent-`lib/` race those guards exist
  // to prevent.
  const packOut = execFileSync('pnpm', ['pack', '--ignore-scripts', '--json', '--pack-destination', tmp], {
    cwd: BUNDLE_DIR,
    encoding: 'utf8',
    timeout: BUILD_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  })
  const { filename: tarballPath } = JSON.parse(packOut) as { filename: string }

  const dshHome = join(tmp, 'home')
  mkdirSync(dshHome, { recursive: true })

  dlx(
    ['plugin', '--profile', 'zeal', 'add', tarballPath, '@deepseek-ai/dsh-code-runtime-worker-thread'],
    dshHome,
  )

  return { dshHome, tarballPath }
}

/** Boots the `zeal` profile with `--dump-config` and parses the composed row list. */
export function dumpConfig(dshHome: string): Row[] {
  const out = dlx(['--profile', 'zeal', '--dump-config'], dshHome)
  return parse(out, { customTags: [JS_TAG] }) as Row[]
}
