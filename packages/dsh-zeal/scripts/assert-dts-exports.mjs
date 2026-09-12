#!/usr/bin/env node
/**
 * I7 (final-review fix wave, Ruling R6) build-time check: `package.json`'s
 * `exports` map declares plain, stable `.d.ts` paths for this package's
 * three public entry points (`.`, `./tui`, `./gauntlet-runner`). tsdown's
 * default (bundled) `.d.ts` emission mode names its output by CONTENT HASH
 * instead (e.g. `lib/tui/index-UpgRn4ms.d.ts`), which silently breaks every
 * consumer's type resolution — `import type` from this package would fail to
 * find declarations at all, with no error until a consumer actually tries to
 * typecheck against it. `--unbundle` (added to this package's `build`
 * script alongside this check) is the actual fix, making tsdown mirror
 * source file paths 1:1 for both `.js` and `.d.ts` output; this script is
 * the regression guard that catches it if that ever stops being true (a
 * tsdown upgrade changing defaults, a build script edit dropping the flag,
 * etc.) by failing the build loudly instead of shipping silently-broken
 * types.
 *
 * Reads the exact paths to check directly out of `package.json`'s `exports`
 * map (`types` field of each entry) rather than hardcoding them a second
 * time here, so the two can never drift out of sync with each other.
 * @module @zealagent/dsh-zeal/scripts/assert-dts-exports
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const packageJsonPath = join(packageRoot, 'package.json')
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))

/** Every `types` path declared anywhere in the exports map, deduped. */
function declaredTypesPaths(exportsMap) {
  const paths = new Set()
  for (const value of Object.values(exportsMap)) {
    if (typeof value === 'object' && value !== null && typeof value.types === 'string') {
      paths.add(value.types)
    }
  }
  return [...paths]
}

const declared = declaredTypesPaths(packageJson.exports ?? {})
if (declared.length === 0) {
  console.error('assert-dts-exports: found no "types" entries in package.json\'s exports map — check the map itself, not just the build.')
  process.exit(1)
}

const missing = declared.filter((relativePath) => !existsSync(join(packageRoot, relativePath)))

if (missing.length > 0) {
  console.error('assert-dts-exports: the following .d.ts paths are declared in package.json\'s "exports" map but do not exist after build:')
  for (const path of missing) console.error(`  - ${path}`)
  console.error('This means tsdown emitted differently-named (likely content-hashed) .d.ts files instead — see this script\'s module doc comment.')
  process.exit(1)
}

console.log(`assert-dts-exports: all ${declared.length} declared .d.ts export path(s) exist: ${declared.join(', ')}`)
