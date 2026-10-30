import type { ProjectMapGraph } from './project-map-graph'
import type {
  GrowthTreeBar,
  GrowthTreeEdge,
  GrowthTreeLane,
  GrowthTreeProject
} from './growth-tree-types'

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

type Lanes = {
  lanes: Map<string, GrowthTreeLane>
  projects: GrowthTreeProject[]
  deriveEdges: GrowthTreeEdge[]
}

/**
 * One lane per workspace, the derived ones under their parent. A folder workspace is not a git
 * checkout, so it has no parent and no derive line, and a workspace with no chats folds away
 * unless a derived child below it has some.
 */
export function buildGrowthLanes(
  graphs: readonly ProjectMapGraph[],
  projects: readonly { id: string; name: string }[],
  bars: ReadonlyMap<string, GrowthTreeBar>,
  now: number
): Lanes {
  const lanes = new Map<string, GrowthTreeLane>()
  const barsByLane = new Map<string, GrowthTreeBar[]>()
  for (const bar of bars.values()) {
    barsByLane.set(bar.workspaceId, [...(barsByLane.get(bar.workspaceId) ?? []), bar])
  }
  for (const graph of graphs) {
    for (const workspace of graph.workspaces.values()) {
      const own = (barsByLane.get(workspace.worktreeId) ?? []).sort(
        (a, b) => a.start - b.start || cmp(a.id, b.id)
      )
      const folder = workspace.workspaceKind === 'folder'
      lanes.set(workspace.worktreeId, {
        id: workspace.worktreeId,
        projectId: graph.projectId,
        name: workspace.worktreeName,
        kind: workspace.workspaceKind,
        hostKind: workspace.hostKind,
        hostLabel: workspace.hostKind === 'local' ? null : (workspace.hostLabel ?? null),
        parentId: folder ? null : workspace.parentId,
        childIds: [],
        barIds: own.map((bar) => bar.id),
        start: own[0]?.start ?? null,
        workspace
      })
    }
  }
  for (const lane of lanes.values()) {
    if (lane.parentId && lanes.has(lane.parentId)) {
      lanes.get(lane.parentId)!.childIds.push(lane.id)
    } else {
      lane.parentId = null
    }
  }
  const byName = (a: string, b: string): number =>
    cmp(lanes.get(a)!.name, lanes.get(b)!.name) || cmp(a, b)
  for (const lane of lanes.values()) {
    lane.childIds.sort(byName)
  }
  const reach = new Map<string, number | null>()
  const reachOf = (id: string): number | null => {
    if (!reach.has(id)) {
      const lane = lanes.get(id)!
      const starts = [lane.start, ...lane.childIds.map(reachOf)].flatMap((value) => value ?? [])
      reach.set(id, starts.length > 0 ? Math.min(...starts) : null)
    }
    return reach.get(id)!
  }
  const deriveEdges: GrowthTreeEdge[] = []
  const groups = projects.map((project): GrowthTreeProject => {
    const roots = [...lanes.values()]
      .filter((lane) => lane.projectId === project.id && !lane.parentId)
      .map((lane) => lane.id)
      .sort(byName)
    const laneIds: string[] = []
    const emptyLaneIds: string[] = []
    const visit = (id: string): void => {
      if (reachOf(id) === null) {
        emptyLaneIds.push(id)
        return
      }
      laneIds.push(id)
      const lane = lanes.get(id)!
      for (const childId of lane.childIds) {
        const child = lanes.get(childId)!
        const at = reachOf(childId)
        if (at !== null && child.kind === 'worktree' && lane.kind === 'worktree') {
          deriveEdges.push({
            id: `derive:${id}>${childId}`,
            kind: 'derive',
            from: id,
            to: childId,
            projectId: project.id,
            at
          })
        }
        visit(childId)
      }
    }
    roots.forEach(visit)
    const own = [...bars.values()].filter((bar) => bar.projectId === project.id)
    return {
      id: project.id,
      name: project.name,
      lastActivity: own.reduce(
        (latest, bar) => Math.max(latest, bar.start, Math.min(now, bar.agent.card.stateChangedAt)),
        0
      ),
      laneIds,
      emptyLaneIds,
      chatCount: own.length,
      workingCount: own.filter((bar) => bar.bucket === 'working').length
    }
  })
  groups.sort((a, b) => b.lastActivity - a.lastActivity || cmp(a.name, b.name) || cmp(a.id, b.id))
  return { lanes, projects: groups, deriveEdges }
}
