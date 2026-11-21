import type { ProjectMapForkInput } from './project-map-graph'
import type { GrowthTreeBar, GrowthTreeReference } from './growth-tree-types'

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** One pointer per carrier and referenced chat; the newest decides whether it reads live. */
export function buildGrowthReferences(
  links: NonNullable<ProjectMapForkInput['references']>,
  barBySession: ReadonlyMap<string, string>,
  bars: ReadonlyMap<string, GrowthTreeBar>
): GrowthTreeReference[] {
  const found = new Map<string, GrowthTreeReference>()
  for (const link of [...links].sort((a, b) => a.createdAt - b.createdAt)) {
    const from = barBySession.get(link.targetSessionId)
    const to = link.source ? barBySession.get(link.source.sessionId) : undefined
    const carrier = from ? bars.get(from) : undefined
    const referenced = to ? bars.get(to) : undefined
    if (!from || !to || from === to || !carrier || !referenced) {
      continue
    }
    if (carrier.projectId !== referenced.projectId) {
      continue
    }
    const id = `reference:${from}>${to}`
    const earlier = found.get(id)
    found.set(id, {
      id,
      kind: 'reference',
      from,
      to,
      projectId: carrier.projectId,
      at: earlier?.at ?? Math.min(carrier.end, Math.max(carrier.start, link.createdAt)),
      live: link.sourceMessageCount === null
    })
  }
  return [...found.values()].sort((a, b) => cmp(a.id, b.id))
}
