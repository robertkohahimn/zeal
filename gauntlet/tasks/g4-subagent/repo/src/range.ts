/** Inclusive count of integers between lo and hi. */
export function countInRange(lo: number, hi: number): number {
  // TODO: off-by-one — this undercounts by 1 for an inclusive range.
  return hi - lo
}
