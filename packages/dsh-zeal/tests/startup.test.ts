import { describe, expect, it } from 'vitest'
import { parseZealArgs } from '../src/startup.ts'

describe('parseZealArgs', () => {
  it('parses --resume and --model', () => {
    expect(parseZealArgs(['--resume', 'session-abc', '--model', 'glm-4.7']))
      .toEqual({ resumeSessionId: 'session-abc', model: 'glm-4.7' })
  })
  it('returns empty values for no args', () => {
    expect(parseZealArgs([])).toEqual({})
  })
  it('throws on unknown flags', () => {
    expect(() => parseZealArgs(['--bogus'])).toThrow()
  })
})
