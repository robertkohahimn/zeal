/**
 * Task 18 — live smoke test (credential-gated). Reuses Task 16's
 * `setupProfile` helper and Task 17's gauntlet-overlay-append flow
 * (`gauntlet-overlay.test.ts`'s own `beforeAll`) to compose a fresh `zeal`
 * profile with the gauntlet overlay applied, then runs `dsh --profile zeal`
 * directly (not `--dump-config`) with `ZEAL_TASK` set — exactly
 * `gauntlet/run.sh`'s own steps 2–5, minus the task-repo/verify.sh scaffold,
 * since this is a bare model-echo smoke check rather than a full gauntlet
 * task.
 *
 * CONTROLLER RULING: no `ZAI_API_KEY` exists in this environment. The one
 * test that makes a real model call (below) is double-gated —
 * `!process.env.ZAI_API_KEY || !process.env.ZEAL_COMPOSITION` — so it never
 * runs here; a maintainer with a real key runs it locally or in CI once
 * that's provisioned:
 *
 *   ZAI_API_KEY=<key> ZEAL_COMPOSITION=1 pnpm vitest run packages/dsh-zeal/tests/composition/live-smoke.test.ts
 *
 * What CAN and DOES run for real in this environment, gated by
 * `ZEAL_COMPOSITION` alone (no key required):
 *
 * - The skip path itself: `ZEAL_COMPOSITION=1` with no `ZAI_API_KEY` still
 *   skips the live-call suite (asserted indirectly by this file's own test
 *   run producing zero executed tests for that block — see the task report
 *   for the transcript).
 * - An auth-boundary probe: install the SAME composed profile (real bundle,
 *   real overlay, real `dsh` CLI) into a scratch `$DSH_HOME`, run it with a
 *   syntactically-valid but FAKE `ZAI_API_KEY`, and assert the run fails at
 *   the provider's credential check rather than at any earlier wiring step
 *   (module resolution, plugin composition, agent creation). This proves
 *   every link in the chain up to — but not across — the real API boundary,
 *   without spending a real credential or a model call. Kept tolerant of
 *   the exact provider error shape (see the test's own comment).
 * @module @zealagent/dsh-zeal/tests/composition/live-smoke
 */

import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { DSH_VERSION, setupProfile } from './helpers.ts'

// Bootstrapping through the real dsh CLI (pnpm build, pnpm pack, pnpm dlx
// install) takes minutes, not milliseconds — mirrors invariants.test.ts and
// gauntlet-overlay.test.ts's own budget.
vi.setConfig({ testTimeout: 600_000, hookTimeout: 600_000 })

/** Absolute path to `gauntlet/overlay.cordis.yml`, regardless of cwd. */
const OVERLAY_FILE = fileURLToPath(new URL('../../../../gauntlet/overlay.cordis.yml', import.meta.url))

/** The exact smoke task text from this task's brief. */
const SMOKE_TASK = 'Run: echo zeal-smoke-$((6*7)) and tell me the exact output'

/** One `dsh --profile zeal` invocation's captured process outcome. */
interface DshRun {
  status: number | null
  stdout: string
  stderr: string
}

/**
 * Runs the composed `zeal` profile directly (not `--dump-config`) via
 * `pnpm dlx`, mirroring `helpers.ts`'s own `dlx()` but using `spawnSync`
 * instead of `execFileSync` — the caller here needs the exit code and both
 * streams even on a NON-ZERO exit (a fake-key run is expected to fail),
 * where `execFileSync` would throw and discard them.
 */
function runDsh(dshHome: string, extraEnv: Record<string, string>): DshRun {
  const result = spawnSync('pnpm', ['dlx', `@deepseek-ai/dsh@${DSH_VERSION}`, '--profile', 'zeal'], {
    env: { ...process.env, DSH_HOME: dshHome, ...extraEnv },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 300_000,
    killSignal: 'SIGKILL',
  })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

/** Installs the real bundle + gauntlet overlay into a fresh scratch `$DSH_HOME`'s `zeal` profile — exactly `gauntlet-overlay.test.ts`'s own `beforeAll`. */
function setupOverlaidProfile(tmp: string): string {
  const { dshHome } = setupProfile(tmp)
  copyFileSync(OVERLAY_FILE, join(dshHome, 'profiles', 'zeal', 'cordis.patch.yml'))
  return dshHome
}

describe.skipIf(!process.env['ZAI_API_KEY'] || !process.env['ZEAL_COMPOSITION'])(
  'zeal live GLM smoke (real dsh harness, real model call)',
  () => {
    let tmp: string
    let dshHome: string

    beforeAll(() => {
      tmp = mkdtempSync(join(tmpdir(), 'zeal-live-smoke-'))
      dshHome = setupOverlaidProfile(tmp)
    })

    afterAll(() => {
      if (tmp) rmSync(tmp, { recursive: true, force: true })
    })

    it('runs the smoke task through a real GLM call and echoes zeal-smoke-42', () => {
      const { stdout } = runDsh(dshHome, { ZEAL_TASK: SMOKE_TASK })
      expect(stdout).toContain('zeal-smoke-42')
    })
  },
)

describe.skipIf(!process.env['ZEAL_COMPOSITION'])(
  'zeal reaches the provider auth boundary (fake credential, no real model call)',
  () => {
    let tmp: string
    let dshHome: string

    beforeAll(() => {
      tmp = mkdtempSync(join(tmpdir(), 'zeal-smoke-authboundary-'))
      dshHome = setupOverlaidProfile(tmp)
    })

    afterAll(() => {
      if (tmp) rmSync(tmp, { recursive: true, force: true })
    })

    it('fails with a credential/auth-shaped error rather than a wiring error', () => {
      const { status, stdout, stderr } = runDsh(dshHome, {
        // Syntactically plausible but never-valid — never spend/consume a
        // real credential; the point is to exercise the SAME code path a
        // real key would (provider composition, request construction,
        // credential header) up to, but not across, the provider's own
        // auth check.
        ZAI_API_KEY: 'sk-fake-zeal-smoke-test-0000000000000000000000000000',
        ZEAL_TASK: SMOKE_TASK,
      })
      const combined = `${stdout}\n${stderr}`

      // The run must not report success with a fake key.
      expect(status, `expected a non-zero exit; got ${status}. stdout=${stdout}\nstderr=${stderr}`).not.toBe(0)

      // Tolerant of the exact provider error shape (spec: assert on an
      // auth/credential indicator in either stream, OR — failing that —
      // that we at least reached zeal-gauntlet-runner's own error-reporting
      // path (the `dsh: ...` line gauntlet-runner.ts's `fail()`/`run()`
      // write on failure), which distinguishes "we got to the API boundary
      // and it errored" from "the run crashed before ever reaching it"
      // (module resolution, plugin composition, agent creation).
      const authIndicator = /auth|credential|unauthorized|forbidden|invalid[ _-]?(api[ _-]?)?key|api[ _-]?key|401|403/i
      const reachedRunnerErrorPath = /^dsh: /m.test(stderr)
      expect(
        authIndicator.test(combined) || reachedRunnerErrorPath,
        `expected an auth/credential-shaped error or the runner's own error line ("dsh: ...") in stderr; ` +
          `got stdout=${stdout}\nstderr=${stderr}`,
      ).toBe(true)
    })
  },
)
