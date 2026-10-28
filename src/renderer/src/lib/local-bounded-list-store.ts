// A desktop-local list in localStorage, newest last and cut to a cap; same store shape as
// terminal-fork-origins, for the project map's own per-desktop preferences.

export type LocalBoundedListStore<T> = {
  read: () => readonly T[]
  write: (next: readonly T[]) => void
  subscribe: (listener: () => void) => () => void
}

export function createLocalBoundedListStore<T>(
  storageKey: string,
  cap: number,
  isEntry: (value: unknown) => value is T
): LocalBoundedListStore<T> {
  let cache: readonly T[] | null = null
  const listeners = new Set<() => void>()
  return {
    read: () => {
      if (cache) {
        return cache
      }
      try {
        const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]')
        cache = Array.isArray(saved) ? saved.filter(isEntry).slice(-cap) : []
      } catch {
        cache = []
      }
      return cache
    },
    write: (next) => {
      cache = next.slice(-cap)
      try {
        localStorage.setItem(storageKey, JSON.stringify(cache))
      } catch {}
      listeners.forEach((listener) => listener())
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}
