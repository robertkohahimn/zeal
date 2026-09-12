import { lookupUser, type User } from './db.ts'

// Duplicate #2 of getUser/getUserSync (copy-pasted from serviceAlpha.ts).
export async function getUser(id: string): Promise<User> {
  return lookupUser(id)
}

export function getUserSync(id: string): User {
  return lookupUser(id)
}
