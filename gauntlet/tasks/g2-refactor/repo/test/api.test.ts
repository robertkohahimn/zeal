import { describe, expect, it } from 'vitest'
// Canonical, unified module the task asks to create — does not exist yet in
// the unmodified repo, so this import (and thus this whole suite) fails
// until getUser/getUserSync are unified into src/userApi.ts.
import { getUser } from '../src/userApi.ts'
import { greetAlpha, greetBeta, greetGamma } from '../src/callers.ts'

describe('unified getUser', () => {
  it('resolves a known user asynchronously', async () => {
    await expect(getUser('u1')).resolves.toEqual({ id: 'u1', name: 'Ada' })
  })

  it('rejects an unknown user', async () => {
    await expect(getUser('nope')).rejects.toThrow(/no such user/)
  })
})

describe('callers use the unified async API', () => {
  it('greetAlpha awaits the unified getUser', async () => {
    await expect(greetAlpha('u1')).resolves.toBe('Hello, Ada!')
  })

  it('greetBeta awaits the unified getUser', async () => {
    await expect(greetBeta('u2')).resolves.toBe('Hello, Grace!')
  })

  it('greetGamma awaits the unified getUser', async () => {
    await expect(greetGamma('u3')).resolves.toBe('Hello, Katherine!')
  })
})
