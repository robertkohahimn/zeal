/** Apply a percentage discount (0-100) to a price. */
export function applyDiscount(price: number, percentOff: number): number {
  // TODO: wrong operator — this ADDS the discount instead of subtracting it.
  return price + price * (percentOff / 100)
}
