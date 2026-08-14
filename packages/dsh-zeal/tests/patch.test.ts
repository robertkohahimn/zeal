import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const path = fileURLToPath(new URL('../cordis.patch.yml', import.meta.url))
type Row = { id?: string; name?: string; disabled?: boolean; config?: any; insert?: Row[] }
const rows: Row[] = parse(readFileSync(path, 'utf8'))
const byId = new Map(rows.filter(r => r.id).map(r => [r.id!, r]))
const inserted = rows.flatMap(r => r.insert ?? [])

describe('zeal patch invariants (spec §4)', () => {
  it('retargets llm-pi-ai with both zai routes', () => {
    const cfg = byId.get('llm-pi-ai')!.config
    expect(Object.keys(cfg.providers)).toEqual(['zai', 'zai-coding-cn'])
    expect(cfg.providers['zai'].apiKeyEnv).toBe('ZAI_API_KEY')
    expect(cfg.providers['zai-coding-cn'].apiKeyEnv).toBe('ZHIPU_API_KEY')
  })
  it('retargets the default model to zai/glm-5.2', () => {
    expect(byId.get('agent-default-model')!.config).toEqual({ provider: 'zai', model: 'glm-5.2' })
  })
  it('disables deepseek adapter, hmr, telemetry, and web search', () => {
    for (const id of ['llm-deepseek', 'hmr', 'session-telemetry-otel', 'web-search-deepseek', 'tool-web']) {
      expect(byId.get(id)?.disabled, id).toBe(true)
    }
  })
  it('inserts code-runtime and the two zeal plugins', () => {
    const names = inserted.map(r => r.name)
    expect(names).toContain('@deepseek-ai/dsh-code-runtime-worker-thread')
    expect(names).toContain('@zealagent/dsh-zeal/startup')
    expect(names).toContain('@zealagent/dsh-zeal/tui')
  })
  it('sets the Zeal persona', () => {
    expect(byId.get('system-prompt')!.config.persona).toContain('Zeal')
  })
  it('names only packages that are bundle dependencies (spec V5 rule)', () => {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))
    for (const row of inserted) {
      const bare = row.name!.startsWith('@') ? row.name!.split('/').slice(0, 2).join('/') : row.name!.split('/')[0]
      if (bare === '@zealagent/dsh-zeal') continue
      expect(pkg.dependencies, `row ${row.id} names ${bare}`).toHaveProperty(bare)
    }
  })
})
