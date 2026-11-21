import type { ProjectMapAgent } from './project-map-graph'
import type { ProjectMapWire } from './project-map-layout'

export type ProjectMapNodeReferences = {
  /** References its sent messages carried. */
  count: number
  /** Of those, the ones with no wire showing: a source elsewhere, or one not left of it. */
  folded: number
  pinIn: boolean
  pinOut: boolean
  /** A same-column reference arrives on the right, beside the arc that brings it. */
  pinInRight: boolean
}

/** Reference pins and counts per drawn node; a backward or external reference folds into the count. */
export function projectMapNodeReferences(
  agents: ReadonlyMap<string, ProjectMapAgent>,
  wires: readonly ProjectMapWire[]
): Map<string, ProjectMapNodeReferences> {
  const byNode = new Map<string, ProjectMapNodeReferences>()
  const entry = (id: string): ProjectMapNodeReferences => {
    const known = byNode.get(id) ?? {
      count: 0,
      folded: 0,
      pinIn: false,
      pinOut: false,
      pinInRight: false
    }
    byNode.set(id, known)
    return known
  }
  for (const agent of agents.values()) {
    if (agent.referencesIn) {
      Object.assign(entry(agent.card.paneKey), {
        count: agent.referencesIn.count,
        folded: agent.referencesIn.external
      })
    }
  }
  for (const wire of wires) {
    if (wire.kind !== 'reference') {
      continue
    }
    entry(wire.from).pinOut = true
    const target = entry(wire.to)
    if (wire.backward) {
      target.folded += 1
    } else if (wire.side) {
      target.pinInRight = true
    } else {
      target.pinIn = true
    }
  }
  return byNode
}
