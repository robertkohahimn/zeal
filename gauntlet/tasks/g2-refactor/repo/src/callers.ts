import { getUserSync as getUserSyncAlpha } from './serviceAlpha.ts'
import { getUser as getUserBeta } from './serviceBeta.ts'
import { getUserSync as getUserSyncGamma } from './serviceGamma.ts'

// Three callers, each inconsistently wired to one of the three duplicated
// services (some sync, some async). Update all three to import and await
// the single unified async getUser once it exists.
export function greetAlpha(id: string): string {
  const user = getUserSyncAlpha(id)
  return `Hello, ${user.name}!`
}

export async function greetBeta(id: string): Promise<string> {
  const user = await getUserBeta(id)
  return `Hello, ${user.name}!`
}

export function greetGamma(id: string): string {
  const user = getUserSyncGamma(id)
  return `Hello, ${user.name}!`
}
