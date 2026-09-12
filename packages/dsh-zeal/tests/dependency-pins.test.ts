/**
 * Guards the dependency-pinning invariants that `driver.ts`'s runtime
 * imports rely on but TypeScript/vitest can't check on their own — see
 * task-12's fix report, IMPORTANT-3.
 *
 * `@deepseek-ai/dsh-scope` (a runtime peer of both `@deepseek-ai/dsh-session`
 * and `@deepseek-ai/dsh-agent`, at two non-overlapping semver ranges) holds
 * module-local `Symbol`/`WeakMap` identity state internally. Two physically
 * distinct copies loaded into the same process would each mint their own
 * identity symbols, silently breaking the scoped `session/event` filtering
 * `ZealDriver` depends on (a listener registered against one copy's scope
 * carrier would never match events tagged by the other copy). The root
 * `package.json`'s `pnpm.overrides` entry forces every consumer to resolve
 * the SAME pinned version, so pnpm's content-addressable store collapses
 * them to one physical directory — this test asserts that actually holds.
 * @module @zealagent/dsh-zeal/tests/dependency-pins
 */

import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const pnpmStoreDir = fileURLToPath(new URL('../../../node_modules/.pnpm', import.meta.url))

describe('dependency pinning invariants', () => {
  it('(IMPORTANT-3) exactly one @deepseek-ai/dsh-scope copy exists under node_modules/.pnpm', () => {
    const entries = readdirSync(pnpmStoreDir).filter(name => name.startsWith('@deepseek-ai+dsh-scope@'))
    expect(entries).toHaveLength(1)
  })
})
