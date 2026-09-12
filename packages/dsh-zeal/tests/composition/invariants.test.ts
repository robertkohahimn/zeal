/**
 * Task 16 — composition integration test.
 *
 * This is the first time the packed bundle meets the REAL dsh harness: a
 * temp profile is bootstrapped with the real `dsh` CLI (via `pnpm dlx`, see
 * `helpers.ts`), our packed bundle is installed into it, and the composed
 * config tree (`--dump-config`, base + zeal patch layers merged) is
 * verified. Network access + several minutes are required, so this whole
 * suite is gated behind `ZEAL_COMPOSITION=1`:
 *
 *   ZEAL_COMPOSITION=1 pnpm vitest run packages/dsh-zeal/tests/composition/invariants.test.ts
 *
 * (a) INVARIANTS below mirror `tests/patch.test.ts` (Task 2) one-for-one,
 * but read from the COMPOSED tree instead of the raw local `cordis.patch.yml`
 * — proving the patch actually applies over the real `@deepseek-ai/dsh-base`
 * bundle, not just that our YAML is well-formed — plus extra invariants that
 * only the composed tree can prove: base rows the patch never touches
 * survive and stay enabled, and code-runtime/zeal-startup/zeal-tui actually
 * resolve as installable rows in a real, freshly-`pnpm install`ed profile
 * (the V5 hoisted-resolution guarantee this task exists to exercise for
 * real).
 *
 * (b) The FULL-TREE SNAPSHOT is a deliberate-update artifact (spec §2.3): CI
 * only runs it when `ZEAL_COMPOSITION=1`, and a diff against the committed
 * snapshot is exactly the artifact an upgrade review reads.
 * @module @zealagent/dsh-zeal/tests/composition/invariants
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { stringify as yamlStringify } from 'yaml'
import { dumpConfig, setupProfile, type Row } from './helpers.ts'

// Bootstrapping through the real dsh CLI (pnpm build, pnpm pack, pnpm dlx
// install, pnpm dlx --dump-config) takes minutes, not milliseconds.
vi.setConfig({ testTimeout: 600_000, hookTimeout: 600_000 })

const gated = process.env['ZEAL_COMPOSITION']

describe.skipIf(!gated)('zeal composition (real dsh harness)', () => {
  let tmp: string
  let rows: Row[]
  let byId: Map<string, Row>

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'zeal-composition-'))
    const { dshHome } = setupProfile(tmp)
    rows = dumpConfig(dshHome)
    byId = new Map(rows.filter(r => r.id).map(r => [r.id as string, r]))
  })

  afterAll(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true })
  })

  describe('invariants (spec §4, composed tree)', () => {
    it('retargets llm-pi-ai with both zai routes', () => {
      const cfg = byId.get('llm-pi-ai')!.config as { providers: Record<string, { apiKeyEnv: string }> }
      expect(Object.keys(cfg.providers)).toEqual(['zai', 'zai-coding-cn'])
      expect(cfg.providers['zai']!.apiKeyEnv).toBe('ZAI_API_KEY')
      expect(cfg.providers['zai-coding-cn']!.apiKeyEnv).toBe('ZHIPU_API_KEY')
    })

    it('retargets the default model to zai/glm-5.2', () => {
      expect(byId.get('agent-default-model')!.config).toEqual({ provider: 'zai', model: 'glm-5.2' })
    })

    it('disables deepseek adapter, hmr, telemetry, and web search', () => {
      for (const id of ['llm-deepseek', 'hmr', 'session-telemetry-otel', 'web-search-deepseek', 'tool-web']) {
        expect(byId.get(id)?.disabled, id).toBe(true)
      }
    })

    it('installs code-runtime and the two zeal plugins', () => {
      const names = rows.map(r => r.name)
      expect(names).toContain('@deepseek-ai/dsh-code-runtime-worker-thread')
      expect(names).toContain('@zealagent/dsh-zeal/startup')
      expect(names).toContain('@zealagent/dsh-zeal/tui')
    })

    it('sets the Zeal persona', () => {
      expect((byId.get('system-prompt')!.config as { persona: string }).persona).toContain('Zeal')
    })

    it('names only packages that are bundle dependencies (spec V5 rule)', () => {
      const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'))
      // The rows this bundle's own patch inserts — the only ones V5's "row
      // names must be deps" rule applies to (base's own rows are base's to
      // vet, not ours).
      for (const id of ['code-runtime', 'zeal-startup', 'zeal-tui']) {
        const row = byId.get(id)!
        const name = row.name!
        const bare = name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0]!
        if (bare === '@zealagent/dsh-zeal') continue
        expect(pkg.dependencies, `row ${id} names ${bare}`).toHaveProperty(bare)
      }
    })

    it('carries the base rows the patch targets through composition (carry-forward check)', () => {
      // These are exactly the ids our patch rewrites; if any didn't exist in
      // the real dsh-base bundle, the assertions above would already have
      // thrown on a missing row — this makes the "exists" half explicit.
      for (const id of [
        'llm-pi-ai',
        'agent-default-model',
        'hmr',
        'tool-web',
        'web-search-deepseek',
        'session-telemetry-otel',
        'system-prompt',
      ]) {
        expect(byId.has(id), id).toBe(true)
      }
    })

    it('leaves untouched base rows present and enabled', () => {
      for (const id of ['agent-loop', 'tool-bash', 'tool-fs', 'subagent', 'tool-todo', 'skill', 'compaction-basic']) {
        const row = byId.get(id)
        expect(row, id).toBeDefined()
        // tool-bash/tool-pwsh disable conditionally on `process.platform`
        // (an unevaluated `!!js` expression string here, see helpers.ts) —
        // "enabled" means not hard-disabled by our patch, i.e. never the
        // literal boolean `true`.
        expect(row!.disabled, id).not.toBe(true)
      }
    })

    it('resolves the session-title-first-prompt-llm row with no pinned provider/model', () => {
      const row = byId.get('session-title-llm')
      expect(row, 'session-title-llm row').toBeDefined()
      expect(row!.name).toBe('@deepseek-ai/dsh-session-title-first-prompt-llm')
      const cfg = (row!.config ?? {}) as Record<string, unknown>
      expect(cfg).not.toHaveProperty('provider')
      expect(cfg).not.toHaveProperty('model')
    })
  })

  it('matches the full composed-tree snapshot (deliberate-update artifact, spec §2.3)', () => {
    expect(yamlStringify(rows)).toMatchSnapshot()
  })
})
