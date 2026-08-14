import { lookupUser, type User } from './db.ts'

// Duplicate #1 of getUser/getUserSync. Copy-pasted into serviceBeta.ts and
// serviceGamma.ts as well — this is the duplication the task asks to unify.
export async function getUser(id: string): Promise<User> {
  return lookupUser(id)
}

export function getUserSync(id: string): User {
  return lookupUser(id)
}
