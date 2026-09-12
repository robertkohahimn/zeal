import { describe, expect, it } from 'vitest'
import { dedupeLineItems, isValidSku, normalizeOrderId, parseQuantity, summarizeIntake } from './stageA.ts'
import { clampQuantity, isPlausibleEmail, isNonEmptyAddress, validateOrder } from './stageB.ts'
import { applyMemberDiscount, lineTotal, roundToCents, sumLineTotals } from './stageC.ts'
import { applyPercentOff, percentOffForCode, stackDiscounts } from './stageD.ts'
import { taxAmount, taxRateForRegion, totalWithTax } from './stageE.ts'
import { finalShippingCost, qualifiesForFreeShipping, shippingWeight } from './stageF.ts'
import { hasStock, isLowStock, reserveStock } from './stageG.ts'
import { confirmationSubject, shouldNotify } from './stageH.ts'

describe('stage A — intake', () => {
  it('normalizes order ids', () => {
    expect(normalizeOrderId('  ord-1  ')).toBe('ORD-1')
  })
  it('parses quantities', () => {
    expect(parseQuantity('3')).toBe(3)
    expect(parseQuantity('nope')).toBe(0)
  })
  it('validates SKUs', () => {
    expect(isValidSku('AB-1234')).toBe(true)
    expect(isValidSku('bad-sku')).toBe(false)
  })
  it('dedupes line items', () => {
    expect(dedupeLineItems(['AB-1234', 'AB-1234', 'CD-5678'])).toEqual(['AB-1234', 'CD-5678'])
  })
  it('summarizes intake', () => {
    expect(summarizeIntake(['AB-1234', 'CD-5678'])).toBe('2 line item(s)')
  })
})

describe('stage B — validation', () => {
  it('checks non-empty addresses', () => {
    expect(isNonEmptyAddress('123 Main St')).toBe(true)
    expect(isNonEmptyAddress('   ')).toBe(false)
  })
  it('checks plausible emails', () => {
    expect(isPlausibleEmail('a@b.com')).toBe(true)
    expect(isPlausibleEmail('nope')).toBe(false)
  })
  it('clamps quantities', () => {
    expect(clampQuantity(15, 10)).toBe(10)
    expect(clampQuantity(-1, 10)).toBe(0)
  })
  it('validates whole orders', () => {
    expect(validateOrder(['AB-1234'], '123 Main St')).toBe(true)
    expect(validateOrder([], '123 Main St')).toBe(false)
  })
})

describe('stage C — pricing', () => {
  it('computes line totals', () => {
    expect(lineTotal(10, 3)).toBe(30)
  })
  it('sums line totals', () => {
    expect(sumLineTotals([10, 20, 30])).toBe(60)
  })
  it('applies a member discount for long-standing members', () => {
    // memberSinceMs is BEFORE cutoffMs — a long-standing member — and
    // should qualify for the discount. This is the one failing test the
    // task asks the model to fix (stageC.ts's applyMemberDiscount has an
    // inverted comparison).
    const memberSinceMs = 1000
    const cutoffMs = 5000
    expect(applyMemberDiscount(100, memberSinceMs, cutoffMs)).toBe(90)
  })
  it('rounds to cents', () => {
    expect(roundToCents(10.005)).toBeCloseTo(10.01, 2)
  })
})

describe('stage D — discount codes', () => {
  it('looks up percent-off by code', () => {
    expect(percentOffForCode('SAVE10')).toBe(10)
    expect(percentOffForCode('UNKNOWN')).toBe(0)
  })
  it('applies percent-off', () => {
    expect(applyPercentOff(100, 10)).toBe(90)
  })
  it('stacks discounts in order', () => {
    expect(stackDiscounts(100, [10, 10])).toBeCloseTo(81, 5)
  })
})

describe('stage E — tax', () => {
  it('looks up tax rate by region', () => {
    expect(taxRateForRegion('OR')).toBe(0)
    expect(taxRateForRegion('CA')).toBeCloseTo(0.0725, 5)
  })
  it('computes tax amount', () => {
    expect(taxAmount(100, 0.05)).toBeCloseTo(5, 5)
  })
  it('computes total with tax', () => {
    expect(totalWithTax(100, 0.05)).toBeCloseTo(105, 5)
  })
})

describe('stage F — shipping', () => {
  it('sums shipment weight', () => {
    expect(shippingWeight([1, 2, 3])).toBe(6)
  })
  it('qualifies for free shipping above threshold', () => {
    expect(qualifiesForFreeShipping(60)).toBe(true)
    expect(qualifiesForFreeShipping(10)).toBe(false)
  })
  it('waives shipping cost when free-shipping-eligible', () => {
    expect(finalShippingCost(10, 60)).toBe(0)
  })
})

describe('stage G — inventory', () => {
  it('checks stock availability', () => {
    expect(hasStock(5, 3)).toBe(true)
    expect(hasStock(2, 3)).toBe(false)
  })
  it('reserves stock', () => {
    expect(reserveStock(5, 3)).toBe(2)
  })
  it('flags low stock', () => {
    expect(isLowStock(2, 5)).toBe(true)
    expect(isLowStock(10, 5)).toBe(false)
  })
})

describe('stage H — notification', () => {
  it('builds a confirmation subject', () => {
    expect(confirmationSubject('ORD-1')).toBe('Your order ORD-1 is confirmed')
  })
  it('decides whether to notify', () => {
    expect(shouldNotify(true, true)).toBe(true)
    expect(shouldNotify(false, true)).toBe(false)
  })
})
