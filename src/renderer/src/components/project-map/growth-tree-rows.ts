import type { GrowthTree, GrowthTreeEdge, GrowthTreeProject } from './growth-tree-types'

export type GrowthRowEntry = { id: string; kind: 'chat' | 'lane'; laneId: string; at: number }
type Span = { top: number; bottom: number }
/** Row indices; `parentRow` is fractional when the parent had no chat older than the child. */
type Fork = {
  edgeId: string
  parent: string
  child: string
  parentRow: number
  childRow: number
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
const widen = (span: Span | undefined, row: number): Span =>
  span
    ? { top: Math.min(span.top, row), bottom: Math.max(span.bottom, row) }
    : { top: row, bottom: row }

/** Newest first. A workspace with no chats still gets a row, just before its first derived child. */
function projectEntries(
  tree: GrowthTree,
  project: GrowthTreeProject,
  derives: ReadonlyMap<string, readonly GrowthTreeEdge[]>
): GrowthRowEntry[] {
  const entries: GrowthRowEntry[] = []
  for (const laneId of project.laneIds) {
    const lane = tree.lanes.get(laneId)!
    for (const id of lane.barIds) {
      entries.push({ id, kind: 'chat', laneId, at: tree.bars.get(id)!.start })
    }
    if (lane.barIds.length === 0) {
      const starts = [
        lane.start,
        ...(derives.get(laneId) ?? []).map((edge) => edge.at),
        ...lane.childIds.map((id) => tree.lanes.get(id)?.start ?? null)
      ].flatMap((value) => value ?? [])
      entries.push({
        id: laneId,
        kind: 'lane',
        laneId,
        at: starts.length ? Math.min(...starts) : 0
      })
    }
  }
  return entries.sort(
    (a, b) => b.at - a.at || (a.kind === b.kind ? 0 : a.kind === 'chat' ? -1 : 1) || cmp(a.id, b.id)
  )
}

/** Each lane's rows, widened to the points where its derived children leave it. */
function laneSpans(
  project: GrowthTreeProject,
  entries: readonly GrowthRowEntry[],
  derives: ReadonlyMap<string, readonly GrowthTreeEdge[]>,
  visible: (entry: GrowthRowEntry) => boolean,
  edgeShown: (id: string) => boolean
): { extent: Map<string, Span>; forks: Fork[] } {
  const extent = new Map<string, Span>()
  const rows = new Map<string, number[]>()
  entries.forEach((entry, index) => {
    if (visible(entry)) {
      extent.set(entry.laneId, widen(extent.get(entry.laneId), index))
      rows.set(entry.laneId, [...(rows.get(entry.laneId) ?? []), index])
    }
  })
  const forks: Fork[] = []
  // Children come after their parent in `laneIds`, so walking it backwards settles them first.
  for (const laneId of project.laneIds.toReversed()) {
    for (const edge of derives.get(laneId) ?? []) {
      const child = extent.get(edge.to)
      if (!child || !edgeShown(edge.id)) {
        continue
      }
      const childRow = child.bottom
      const parentRow = rows.get(laneId)?.find((row) => row > childRow) ?? childRow + 0.5
      forks.push({
        edgeId: edge.id,
        parent: laneId,
        child: edge.to,
        parentRow,
        childRow
      })
      extent.set(laneId, widen(extent.get(laneId), parentRow))
    }
  }
  return { extent, forks }
}

/**
 * A column per workspace, a derived one right of its parent. A column is reused once the lane
 * that held it is over, with a free row between, so a project with many short-lived
 * workspaces stays narrow.
 */
function assignColumns(
  project: GrowthTreeProject,
  extent: ReadonlyMap<string, Span>,
  forks: readonly Fork[]
): Map<string, number> {
  const parentOf = new Map(forks.map((fork) => [fork.child, fork]))
  const columns = new Map<string, number>()
  const occupied: Span[][] = []
  const clash = (a: Span, b: Span): boolean => a.top <= b.bottom + 1 && b.top <= a.bottom + 1
  for (const laneId of project.laneIds) {
    const fork = parentOf.get(laneId)
    const span = widen(extent.get(laneId), fork?.parentRow ?? extent.get(laneId)?.top ?? 0)
    const start = fork ? columns.get(fork.parent)! + 1 : 0
    const free = (column: number): boolean =>
      !(occupied[column] ?? []).some((other) => clash(span, other))
    let column = start
    while (column < occupied.length && !free(column)) {
      column++
    }
    ;(occupied[column] ??= []).push(span)
    columns.set(laneId, column)
  }
  return columns
}

/** Rows newest first, a column per workspace, and the lines a replay's moment draws. */
export function planGrowthProject(
  tree: GrowthTree,
  project: GrowthTreeProject,
  shown: GrowthTree,
  shownEdges: ReadonlySet<string>
): {
  entries: GrowthRowEntry[]
  columns: Map<string, number>
  drawn: ReturnType<typeof laneSpans>
} {
  const derives = new Map<string, GrowthTreeEdge[]>()
  for (const edge of tree.edges) {
    if (edge.kind === 'derive' && edge.projectId === project.id) {
      derives.set(edge.from, [...(derives.get(edge.from) ?? []), edge])
    }
  }
  const entries = projectEntries(tree, project, derives)
  const full = laneSpans(
    project,
    entries,
    derives,
    () => true,
    () => true
  )
  const visible = (entry: GrowthRowEntry): boolean =>
    entry.kind === 'chat' ? shown.bars.has(entry.id) : shown === tree || entry.at <= shown.now
  const drawn =
    shown === tree
      ? full
      : laneSpans(project, entries, derives, visible, (id) => shownEdges.has(id))
  return {
    entries,
    columns: assignColumns(project, full.extent, full.forks),
    drawn
  }
}
