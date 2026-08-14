import { describe, expect, it } from 'vitest'
import { titleCase } from './format.ts'

describe('titleCase', () => {
  it('capitalizes each word', () => {
    expect(titleCase('hello world')).toBe('Hello World')
  })

  it('lowercases the rest of each word', () => {
    expect(titleCase('HELLO WORLD')).toBe('Hello World')
  })
})
