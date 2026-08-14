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
import { mkdirSync } from 'node:fs'
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

function dlx(args: string[], dshHome: string): string {
  return execFileSync('pnpm', ['dlx', `@deepseek-ai/dsh@${DSH_VERSION}`, ...args], {
    env: { ...process.env, DSH_HOME: dshHome },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
}

/**
 * Builds the bundle, packs it into `tmp`, creates a fresh `$DSH_HOME` under
 * `tmp`, and installs the packed tarball plus the code-runtime plugin into a
 * `zeal` profile there — all via the REAL `dsh` CLI (through `pnpm dlx`; see
 * the module doc).
 */
export function setupProfile(tmp: string): ComposedProfile {
  // lib/ must exist before `pnpm pack` — pack only ships what "files" globs
  // match on disk, it does not run the build script itself.
  execFileSync('pnpm', ['run', 'build'], { cwd: BUNDLE_DIR, encoding: 'utf8' })

  const packOut = execFileSync('pnpm', ['pack', '--json', '--pack-destination', tmp], {
    cwd: BUNDLE_DIR,
    encoding: 'utf8',
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
