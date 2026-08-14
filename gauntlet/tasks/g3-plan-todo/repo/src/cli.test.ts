import { describe, expect, it } from 'vitest'
import { run } from './cli.ts'

describe('run', () => {
  it('greets in plain text by default', () => {
    expect(run(['Ada'])).toBe('Hello, Ada!')
  })

  it('defaults to World with no name', () => {
    expect(run([])).toBe('Hello, World!')
  })

  it('greets as JSON when --json is present', () => {
    expect(run(['Ada', '--json'])).toBe('{"greeting":"Hello, Ada!"}')
  })

  it('still finds the name when --json comes first', () => {
    expect(run(['--json', 'Grace'])).toBe('{"greeting":"Hello, Grace!"}')
  })
})
