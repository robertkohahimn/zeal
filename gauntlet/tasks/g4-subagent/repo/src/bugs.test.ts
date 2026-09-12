import { describe, expect, it } from 'vitest'
import { applyDiscount } from './discount.ts'
import { countInRange } from './range.ts'
import { unique } from './unique.ts'

describe('countInRange', () => {
  it('counts inclusively', () => {
    expect(countInRange(1, 5)).toBe(5)
  })
})

describe('applyDiscount', () => {
  it('subtracts the discount', () => {
    expect(applyDiscount(100, 25)).toBe(75)
  })
})

describe('unique', () => {
  it('dedupes preserving order', () => {
    expect(unique([1, 2, 2, 3, 1, 4])).toEqual([1, 2, 3, 4])
  })
})
