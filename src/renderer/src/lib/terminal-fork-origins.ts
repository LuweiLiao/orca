// Which terminal pane each "Fork Agent Session…" workspace was forked from. The workspace itself is
// nested under its source on the host (`parentWorktreeId`), which every client sees; which pane
// in it was the source, and which agent it became, is known only to the desktop that forked, so it
// is kept in this desktop's localStorage. Never a session field nor sent.

const STORAGE_KEY = 'orca.terminal-fork-origins.v1'
// A desktop forks rarely; this bounds a store that nothing else prunes.
const MAX_ORIGINS = 200

export type TerminalForkOrigin = {
  /** The fork workspace the "Fork Agent Session…" action created. */
  forkWorktreeId: string
  sourcePaneKey: string
  sourceWorktreeId: string
  /** The agent tab it launched, when it opened one this desktop can name. */
  childTabId: string | null
  createdAt: number
}

let cache: TerminalForkOrigin[] | null = null
const listeners = new Set<() => void>()

function isOrigin(value: unknown): value is TerminalForkOrigin {
  return (
    typeof value === 'object' &&
    value !== null &&
    'forkWorktreeId' in value &&
    typeof value.forkWorktreeId === 'string' &&
    'sourcePaneKey' in value &&
    typeof value.sourcePaneKey === 'string' &&
    'sourceWorktreeId' in value &&
    typeof value.sourceWorktreeId === 'string' &&
    'childTabId' in value &&
    (value.childTabId === null || typeof value.childTabId === 'string') &&
    'createdAt' in value &&
    typeof value.createdAt === 'number'
  )
}

export function terminalForkOrigins(): readonly TerminalForkOrigin[] {
  if (cache) {
    return cache
  }
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    cache = Array.isArray(saved) ? saved.filter(isOrigin) : []
  } catch {
    cache = []
  }
  return cache
}

export function noteTerminalForkOrigin(fork: Omit<TerminalForkOrigin, 'createdAt'>): void {
  const origin = { ...fork, createdAt: Date.now() }
  const next = [
    ...terminalForkOrigins().filter((entry) => entry.forkWorktreeId !== origin.forkWorktreeId),
    origin
  ].slice(-MAX_ORIGINS)
  cache = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {}
  listeners.forEach((listener) => listener())
}

export function subscribeToTerminalForkOrigins(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
