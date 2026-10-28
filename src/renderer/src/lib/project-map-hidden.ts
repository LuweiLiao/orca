// Map nodes the person hid, keyed by the chat's session id (a node's pane key changes when its
// tab closes). A display preference of this desktop only; never sent to a host.

import { createLocalBoundedListStore } from './local-bounded-list-store'

const MAX_HIDDEN = 200

const store = createLocalBoundedListStore(
  'orca.project-map-hidden.v1',
  MAX_HIDDEN,
  (value): value is string => typeof value === 'string'
)

let cachedList: readonly string[] | null = null
let cachedSet: ReadonlySet<string> = new Set()

/** A stable set while nothing changed, so a subscriber's snapshot compares equal. */
export function projectMapHiddenKeys(): ReadonlySet<string> {
  const list = store.read()
  if (list !== cachedList) {
    cachedList = list
    cachedSet = new Set(list)
  }
  return cachedSet
}

export const subscribeToProjectMapHidden = store.subscribe

export function hideProjectMapKeys(keys: readonly string[]): void {
  const hidden = projectMapHiddenKeys()
  const added = keys.filter((key) => !hidden.has(key))
  if (added.length > 0) {
    store.write([...store.read(), ...added])
  }
}

export function showProjectMapKeys(keys: readonly string[]): void {
  const drop = new Set(keys)
  if (store.read().some((key) => drop.has(key))) {
    store.write(store.read().filter((key) => !drop.has(key)))
  }
}
