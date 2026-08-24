/**
 * G2 acceptance, part 2: proves the callers were actually REWIRED onto the
 * unified API, and that the duplication the task names was actually removed.
 *
 * api.test.ts alone cannot prove either. Its caller assertions only check
 * the returned greeting, and the three duplicated services already return
 * the same users the unified module would — so simply marking the existing
 * `greetAlpha`/`greetGamma` `async`, while still importing `getUserSync`
 * from `serviceAlpha`/`serviceGamma`, satisfies every assertion in that
 * file. `src/userApi.ts` would only have to exist, never be used.
 *
 * The two checks below close that hole from both ends: a sentinel mock that
 * only a caller genuinely routed through `src/userApi.ts` can return, and a
 * source-level check that the old implementations and imports are gone (the
 * task asks in as many words to "remove the duplicated implementations from
 * the three service files" and "update every caller").
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

// Hoisted above the `callers` import below by Vitest, so the callers module
// binds to THIS module instead of the real one. The sentinel name appears
// nowhere in db.ts, so a greeting containing it can only have come through
// src/userApi.ts.
vi.mock('../src/userApi.ts', () => ({
  getUser: vi.fn(async (id: string) => ({ id, name: `SENTINEL-${id}` })),
}))

import { greetAlpha, greetBeta, greetGamma } from '../src/callers.ts'
import { getUser } from '../src/userApi.ts'

const srcPath = (file: string) => fileURLToPath(new URL(`../src/${file}`, import.meta.url))
const SERVICES = ['serviceAlpha.ts', 'serviceBeta.ts', 'serviceGamma.ts']

describe('callers are wired to the unified getUser, not the old services', () => {
  it.each([
    ['greetAlpha', greetAlpha],
    ['greetBeta', greetBeta],
    ['greetGamma', greetGamma],
  ])('%s routes through src/userApi.ts', async (_name, greet) => {
    await expect(greet('u1')).resolves.toBe('Hello, SENTINEL-u1!')
    expect(getUser).toHaveBeenCalledWith('u1')
  })
})

describe('the duplicated sync path is gone', () => {
  it('src/callers.ts imports none of the three old service modules', () => {
    const source = readFileSync(srcPath('callers.ts'), 'utf8')
    for (const service of SERVICES) {
      const moduleName = service.replace(/\.ts$/, '')
      expect(source, `callers.ts must no longer import ./${moduleName}.ts`).not.toMatch(
        new RegExp(`from\\s+['"]\\./${moduleName}(\\.ts)?['"]`),
      )
    }
  })

  it('no service file still implements getUser/getUserSync', () => {
    for (const service of SERVICES) {
      const path = srcPath(service)
      // Deleting the file outright is a valid way to remove the duplicate.
      if (!existsSync(path)) continue
      const source = readFileSync(path, 'utf8')
      expect(source, `${service} must no longer declare getUserSync`).not.toMatch(/\bfunction\s+getUserSync\b/)
      expect(source, `${service} must no longer declare getUser`).not.toMatch(/\bfunction\s+getUser\s*\(/)
    }
  })
})
