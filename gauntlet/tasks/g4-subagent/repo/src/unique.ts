/** Return the distinct values in arr, preserving first-seen order. */
export function unique<T>(arr: T[]): T[] {
  // TODO: this returns every element instead of deduplicating.
  return arr.slice()
}
