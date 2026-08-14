/**
 * Task 17 — overlay-composition verification (composition-level, no model
 * call). CONTROLLER RULING: no `ZAI_API_KEY` is available in this
 * environment, so this test proves everything up to the model call — the
 * gauntlet-overlay-augmented profile composes correctly — without ever
 * driving a real agent turn (that is `gauntlet/run.sh`'s own job, recorded
 * PENDING in `GAUNTLET.md`).
 *
 * Reuses Task 16's `setupProfile`/`dumpConfig` helpers to install the real,
 * freshly-packed bundle into a temp `$DSH_HOME`'s `zeal` profile, then
 * appends `gauntlet/overlay.cordis.yml` onto that profile's own
 * `cordis.patch.yml` — exactly `gauntlet/run.sh`'s own step 3 (a
 * freshly-initialized profile's `cordis.patch.yml` is always the literal
 * empty-array placeholder, so overwriting it with the overlay's rows IS
 * appending them onto that empty array) — and `--dump-config`-asserts the
 * overlay actually applied over the REAL composed tree:
 *
 * - `zeal-tui`/`zeal-startup` disabled (the TUI never mounts unattended).
 * - `zeal-gauntlet-runner` present AND RESOLVING in the real composed tree
 *   by id/name (the same V5 hoisted-resolution guarantee Task 16 exercises
 *   for the base three rows — proving the overlay's `insert:` block, not
 *   just the bundle's own, resolves as an installable row in a real,
 *   freshly-`pnpm install`ed profile).
 * - `session-persistence-jsonl` restated with `compression: none` and the
 *   exact base `root` value (a patch REPLACES the row's whole config, so
 *   the overlay has to restate `root` too — see the overlay's own comment).
 *
 * Gated exactly like Task 16's invariants.test.ts:
 *
 *   ZEAL_COMPOSITION=1 pnpm vitest run packages/dsh-zeal/tests/composition/gauntlet-overlay.test.ts
 * @module @zealagent/dsh-zeal/tests/composition/gauntlet-overlay
 */

import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { dumpConfig, setupProfile, type Row } from './helpers.ts'

// Bootstrapping through the real dsh CLI (pnpm build, pnpm pack, pnpm dlx
// install, pnpm dlx --dump-config) takes minutes, not milliseconds.
vi.setConfig({ testTimeout: 600_000, hookTimeout: 600_000 })

const gated = process.env['ZEAL_COMPOSITION']

/** Absolute path to `gauntlet/overlay.cordis.yml`, regardless of cwd. */
const OVERLAY_FILE = fileURLToPath(new URL('../../../../gauntlet/overlay.cordis.yml', import.meta.url))

describe.skipIf(!gated)('zeal gauntlet overlay composition (real dsh harness)', () => {
  let tmp: string
  let rows: Row[]
  let byId: Map<string, Row>

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'zeal-gauntlet-overlay-'))
    const { dshHome } = setupProfile(tmp)
    // Mirrors gauntlet/run.sh's own step 3 exactly.
    copyFileSync(OVERLAY_FILE, join(dshHome, 'profiles', 'zeal', 'cordis.patch.yml'))
    rows = dumpConfig(dshHome)
    byId = new Map(rows.filter(r => r.id).map(r => [r.id as string, r]))
  })

  afterAll(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true })
  })

  it('disables zeal-tui and zeal-startup', () => {
    expect(byId.get('zeal-tui')?.disabled, 'zeal-tui').toBe(true)
    expect(byId.get('zeal-startup')?.disabled, 'zeal-startup').toBe(true)
  })

  it('inserts the zeal-gauntlet-runner row, resolving in the real composed tree', () => {
    const row = byId.get('zeal-gauntlet-runner')
    expect(row, 'zeal-gauntlet-runner row').toBeDefined()
    expect(row!.name).toBe('@zealagent/dsh-zeal/gauntlet-runner')
    expect(row!.config).toHaveProperty('task')
    // Also present in the flat name list (belt-and-suspenders with the byId
    // check above — mirrors invariants.test.ts's own "installs ... zeal
    // plugins" assertion style).
    expect(rows.map(r => r.name)).toContain('@zealagent/dsh-zeal/gauntlet-runner')
  })

  it('restates session-persistence-jsonl with compression: none and the exact base root value', () => {
    const row = byId.get('session-persistence-jsonl')
    expect(row, 'session-persistence-jsonl row').toBeDefined()
    const cfg = row!.config as { root: unknown; compression: string }
    expect(cfg.compression).toBe('none')
    // `!!js` values are kept as their source expression string, not
    // evaluated (see helpers.ts's JS_TAG doc) — this is the exact base
    // value the overlay's own comment requires copying verbatim.
    expect(String(cfg.root)).toBe("dshHomePath('sessions')")
  })
})
