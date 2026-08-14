import { existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { planBootstrap, resolveDshBin, shouldLaunch } from '../src/main.ts'

const INSTALL_ARGS = [
  'plugin',
  '--profile',
  'zeal',
  'add',
  '@zealagent/dsh-zeal',
  '@deepseek-ai/dsh-code-runtime-worker-thread',
]

describe('planBootstrap', () => {
  it('needs init on a fresh home (no profile manifest)', () => {
    const plan = planBootstrap({
      dshHome: '/tmp/does-not-matter',
      profileManifest: undefined,
      argv: [],
    })
    expect(plan.needsInit).toBe(true)
    expect(plan.installArgs).toEqual(INSTALL_ARGS)
  })

  it('needs init when the manifest lacks the zeal dependency', () => {
    const plan = planBootstrap({
      dshHome: '/tmp/does-not-matter',
      profileManifest: { dependencies: { 'some-other-plugin': '1.0.0' } },
      argv: [],
    })
    expect(plan.needsInit).toBe(true)
    expect(plan.installArgs).toEqual(INSTALL_ARGS)
  })

  it('does not need init when the manifest already has the zeal dependency', () => {
    const plan = planBootstrap({
      dshHome: '/tmp/does-not-matter',
      profileManifest: { dependencies: { '@zealagent/dsh-zeal': '0.1.0' } },
      argv: [],
    })
    expect(plan.needsInit).toBe(false)
  })

  it('passes argv through into launchArgs, prefixed with the zeal profile', () => {
    const plan = planBootstrap({
      dshHome: '/tmp/does-not-matter',
      profileManifest: { dependencies: { '@zealagent/dsh-zeal': '0.1.0' } },
      argv: ['--resume', 'session-abc'],
    })
    expect(plan.launchArgs).toEqual(['--profile', 'zeal', '--resume', 'session-abc'])
  })
})

describe('resolveDshBin', () => {
  it('resolves to an existing dsh binary file', () => {
    const bin = resolveDshBin()
    expect(existsSync(bin)).toBe(true)
  })
})

describe('shouldLaunch', () => {
  it('allows launch when the install exited cleanly', () => {
    expect(shouldLaunch({ status: 0 })).toBe(true)
  })

  it('blocks launch when the install exited with a non-zero status', () => {
    expect(shouldLaunch({ status: 1 })).toBe(false)
  })

  it('blocks launch when the install status is null (e.g. killed by signal)', () => {
    expect(shouldLaunch({ status: null })).toBe(false)
  })

  it('blocks launch when the install spawn itself errored', () => {
    expect(shouldLaunch({ status: 0, error: new Error('spawn ENOENT') })).toBe(false)
  })
})

/**
 * (C2) Spawn-level regression test for the symlink-blind `isMainModule`
 * guard. `import.meta.url` is realpath'd by Node's ESM loader before this
 * module's top-level code runs, but `process.argv[1]` is not — and `npm`/
 * `pnpm` install a package's `bin` entry as a symlink under
 * `node_modules/.bin`, exactly how `npx @zealagent/zeal` launches this file
 * in practice. Pre-fix, comparing the two directly meant `isMainModule`
 * evaluated `false` under that symlink, `main()` was never called, and the
 * process exited 0 having silently done nothing. This test exercises the
 * REAL built artifact (not the TS source, which isn't subject to Node's ESM
 * symlink realpathing the same way under `vitest`/`tsx`) through a real
 * symlink, via a real child process, and asserts the bootstrap path was
 * actually attempted.
 */
describe('symlink-blind main-module guard (spawn-level regression, C2)', () => {
  const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
  const libMain = join(packageRoot, 'lib', 'main.js')

  beforeAll(() => {
    // The suite-level `pnpm build` (this task's verification step) normally
    // makes this a no-op; build here too so the test is self-sufficient when
    // run in isolation (e.g. `pnpm vitest run packages/zeal/tests/bootstrap.test.ts`
    // against a clean checkout with no prior build).
    if (!existsSync(libMain)) {
      const build = spawnSync('pnpm', ['run', 'build'], { cwd: packageRoot, stdio: 'inherit' })
      if (build.status !== 0) throw new Error('pnpm run build failed while preparing the spawn-level symlink test')
    }
  }, 120_000)

  it('still attempts the bootstrap when launched via a symlink, instead of exiting 0 silently', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'zeal-symlink-'))
    try {
      const binSymlink = join(tmp, 'zeal-bin.js')
      symlinkSync(libMain, binSymlink)
      // Deliberately fresh and never created: no `profiles/zeal/package.json`
      // means `readProfileManifest` returns `undefined`, so `planBootstrap`
      // sets `needsInit: true` and `main()` takes the install-then-launch
      // path — the path whose fail-fast branch this test's assertion below
      // targets.
      const dshHome = join(tmp, 'dsh-home')

      const result = spawnSync(process.execPath, [binSymlink], {
        cwd: tmp,
        encoding: 'utf8',
        timeout: 60_000,
        env: {
          ...process.env,
          DSH_HOME: dshHome,
          // Belt-and-suspenders "unreachable install step": if the install
          // step's `pnpm add` ever actually reaches a package resolver in
          // some other environment, force it to fail FAST (connection
          // refused) instead of retrying for over a minute against a slow or
          // unreachable real registry — this test only needs proof the
          // bootstrap path was attempted, never that the install succeeds.
          npm_config_registry: 'http://127.0.0.1:1/',
          npm_config_fetch_retries: '0',
          npm_config_fetch_retry_mintimeout: '100',
          npm_config_fetch_retry_maxtimeout: '100',
        },
      })

      // THE regression: pre-fix this asserted `result.status === 0` with
      // empty stdout/stderr (main() never ran). Post-fix, `main()` runs,
      // sees the fresh `DSH_HOME`, and attempts the install step — which
      // fails (module resolution or the unreachable registry above, depending
      // on environment) and is reported through this package's own
      // `installExitCode`/fail-fast branch in `main()`: a nonzero exit plus
      // its diagnostic stderr line, never a silent 0.
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('zeal: failed to install the zeal dsh profile')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }, 60_000)
})
