// The lane row each chat was dropped on, so a child placed by dragging keeps its spot across
// refreshes and restarts. Only this desktop knows it: the host's snapshot carries no position, so
// it is kept in localStorage and never sent.

const STORAGE_KEY = 'orca.project-map-chat-rows.v1'
// A desktop places few chats by hand; this bounds a store that nothing else prunes.
const MAX_ENTRIES = 500

type Entry = { sessionId: string; row: number }

let cache: ReadonlyMap<string, number> | null = null
const listeners = new Set<() => void>()

function isEntry(value: unknown): value is Entry {
  return (
    typeof value === 'object' &&
    value !== null &&
    'sessionId' in value &&
    typeof value.sessionId === 'string' &&
    'row' in value &&
    typeof value.row === 'number' &&
    Number.isInteger(value.row)
  )
}

function read(): Entry[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(saved) ? saved.filter(isEntry) : []
  } catch {
    return []
  }
}

/** Insertion-ordered, so the oldest pins are the ones dropped at the cap. */
export function projectMapChatRows(): ReadonlyMap<string, number> {
  cache ??= new Map(read().map(({ sessionId, row }) => [sessionId, row]))
  return cache
}

export function noteProjectMapChatRow(sessionId: string, row: number): void {
  const next = new Map(projectMapChatRows())
  next.delete(sessionId)
  next.set(sessionId, row)
  const entries = [...next].slice(-MAX_ENTRIES)
  cache = new Map(entries)
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(entries.map(([id, value]) => ({ sessionId: id, row: value })))
    )
  } catch {}
  listeners.forEach((listener) => listener())
}

export function subscribeToProjectMapChatRows(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
