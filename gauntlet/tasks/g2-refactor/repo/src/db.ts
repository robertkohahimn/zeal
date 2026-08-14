// Fake in-memory "database" shared by the three duplicated service files.
export interface User {
  id: string
  name: string
}

const USERS: Record<string, User> = {
  u1: { id: 'u1', name: 'Ada' },
  u2: { id: 'u2', name: 'Grace' },
  u3: { id: 'u3', name: 'Katherine' },
}

/** Synchronous lookup — the "storage" layer every duplicated service wraps. */
export function lookupUser(id: string): User {
  const user = USERS[id]
  if (!user) throw new Error(`no such user: ${id}`)
  return user
}
