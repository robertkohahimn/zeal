/**
 * I7 (final-review fix wave, Ruling R6): `package.json`'s `exports` map
 * declares plain, stable `.d.ts` paths (`./lib/startup.d.ts`,
 * `./lib/tui/index.d.ts`, `./lib/gauntlet-runner.d.ts`) for this package's
 * three public entry points. tsdown's default (bundled) `.d.ts` emission
 * names its output by content hash instead (e.g.
 * `lib/tui/index-UpgRn4ms.d.ts`), silently breaking every consumer's type
 * resolution. The fix is `--unbundle` on this package's `build` script
 * (`package.json`) plus `scripts/assert-dts-exports.mjs`, which fails the
 * build itself if the declared paths ever go missing again. This test is
 * the same assertion surfaced through the ordinary `pnpm test` run, so a
 * regression shows up in the normal test suite too, not only at build time.
 * @module @zealagent/dsh-zeal/tests/dts-exports
 */
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import packageJson from '../package.json' with { type: 'json' }

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Every `types` path declared anywhere in the exports map, deduped — mirrors `scripts/assert-dts-exports.mjs`'s own extraction. */
function declaredTypesPaths(exportsMap: Record<string, unknown>): string[] {
  const paths = new Set<string>()
  for (const value of Object.values(exportsMap)) {
    if (typeof value === 'object' && value !== null && typeof (value as { types?: unknown }).types === 'string') {
      paths.add((value as { types: string }).types)
    }
  }
  return [...paths]
}

describe('package.json exports map .d.ts paths exist after build (I7, Ruling R6)', () => {
  const declared = declaredTypesPaths(packageJson.exports as Record<string, unknown>)

  beforeAll(() => {
    const anyMissing = declared.some((relativePath) => !existsSync(join(packageRoot, relativePath)))
    if (anyMissing) {
      const build = spawnSync('pnpm', ['run', 'build'], { cwd: packageRoot, stdio: 'inherit' })
      if (build.status !== 0) throw new Error('pnpm run build failed while preparing the dts-exports test')
    }
  }, 120_000)

  it('declares exactly the three expected entry points', () => {
    expect(declared.sort()).toEqual(
      ['./lib/startup.d.ts', './lib/tui/index.d.ts', './lib/gauntlet-runner.d.ts'].sort(),
    )
  })

  it('every declared .d.ts export path exists on disk after build', () => {
    for (const relativePath of declared) {
      expect(existsSync(join(packageRoot, relativePath)), `expected ${relativePath} to exist`).toBe(true)
    }
  })
})
