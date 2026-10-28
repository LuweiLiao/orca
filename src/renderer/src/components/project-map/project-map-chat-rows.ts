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

function store(next: ReadonlyMap<string, number>): void {
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

export function noteProjectMapChatRow(sessionId: string, row: number): void {
  const next = new Map(projectMapChatRows())
  next.delete(sessionId)
  next.set(sessionId, row)
  store(next)
}

/** A row per session, or null to drop its pin: the shape both a move and its undo take. */
export type ProjectMapRowChanges = ReadonlyMap<string, number | null>

/** Applies several pins in one write and returns the changes that put them back as they were. */
export function applyProjectMapChatRows(changes: ProjectMapRowChanges): ProjectMapRowChanges {
  const current = projectMapChatRows()
  const before = new Map<string, number | null>()
  const next = new Map(current)
  for (const [sessionId, row] of changes) {
    before.set(sessionId, current.get(sessionId) ?? null)
    next.delete(sessionId)
    if (row !== null) {
      next.set(sessionId, row)
    }
  }
  store(next)
  return before
}

export function subscribeToProjectMapChatRows(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
