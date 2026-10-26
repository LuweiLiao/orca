import type { ProjectMapEdge, ProjectMapGraph } from './project-map-graph'

export const PROJECT_MAP_NODE = {
  workspaceWidth: 172,
  agentWidth: 224,
  height: 66,
  /** Pins sit on the body row, below the 40px header. */
  pinOffsetY: 53
} as const

const WORKSPACE_COLUMN = PROJECT_MAP_NODE.workspaceWidth + 44
const AGENT_COLUMN = PROJECT_MAP_NODE.agentWidth + 64
const ROW = PROJECT_MAP_NODE.height + 22
const LANE_GAP = 8
const LANE_PADDING = 12
const MARGIN = 16
const LOOSE_COLUMNS = 5

export type ProjectMapNodeBox = {
  id: string
  kind: 'workspace' | 'agent'
  x: number
  y: number
  width: number
}

export type ProjectMapLane = {
  workspaceId: string
  x: number
  y: number
  height: number
}

export type ProjectMapWire = ProjectMapEdge & {
  path: string
}

export type ProjectMapLayout = {
  nodes: Map<string, ProjectMapNodeBox>
  lanes: ProjectMapLane[]
  wires: ProjectMapWire[]
  /** Workspaces with no lineage and no agents, gridded below the lanes. */
  looseGroup: { y: number; height: number } | null
  width: number
  height: number
}

/**
 * Deterministic layered layout: workspaces occupy depth columns on the left, agents occupy
 * delegation-depth columns on the right, each workspace owns one horizontal lane. Every edge
 * points to a deeper column, so wires only travel rightward through the gutters.
 */
export function layoutProjectMap(graph: ProjectMapGraph): ProjectMapLayout {
  const nodes = new Map<string, ProjectMapNodeBox>()
  const laneOrder: { id: string; depth: number }[] = []
  const loose: string[] = []
  const visit = (id: string, depth: number): void => {
    laneOrder.push({ id, depth })
    for (const childId of graph.workspaces.get(id)?.childIds ?? []) {
      visit(childId, depth + 1)
    }
  }
  const roots = [...graph.workspaces.values()].filter((workspace) => !workspace.parentId)
  // Trees first so lineage reads top-down; isolated workspaces with agents follow.
  roots.sort((a, b) => Number(b.childIds.length > 0) - Number(a.childIds.length > 0))
  for (const root of roots) {
    if (root.childIds.length === 0 && root.agentPaneKeys.length === 0) {
      loose.push(root.worktreeId)
    } else {
      visit(root.worktreeId, 0)
    }
  }

  const maxWorkspaceDepth = laneOrder.reduce((max, lane) => Math.max(max, lane.depth), 0)
  const agentBaseX = MARGIN + (maxWorkspaceDepth + 1) * WORKSPACE_COLUMN + 24
  const agentDepth = agentDepths(graph)
  const agentOrder = agentDfsOrder(graph, laneOrder)
  const agentsByLane = new Map<string, string[]>()
  for (const paneKey of agentOrder) {
    const workspaceId = graph.agents.get(paneKey)?.card.worktreeId
    if (workspaceId) {
      agentsByLane.set(workspaceId, [...(agentsByLane.get(workspaceId) ?? []), paneKey])
    }
  }

  const lanes: ProjectMapLane[] = []
  let maxAgentDepth = -1
  let y = MARGIN
  for (const { id, depth } of laneOrder) {
    const laneX = MARGIN + depth * WORKSPACE_COLUMN - 8
    const nodeTop = y + LANE_PADDING
    nodes.set(id, {
      id,
      kind: 'workspace',
      x: MARGIN + depth * WORKSPACE_COLUMN,
      y: nodeTop,
      width: PROJECT_MAP_NODE.workspaceWidth
    })
    const nextFreeRow = new Map<number, number>()
    const rowOf = new Map<string, number>()
    let rows = 1
    for (const paneKey of agentsByLane.get(id) ?? []) {
      const column = agentDepth.get(paneKey) ?? 0
      const parentKey = graph.agents.get(paneKey)?.parentPaneKey
      // Keep a same-lane chain on its parent's row so clear continuations read as one line.
      const parentRow = parentKey ? rowOf.get(parentKey) : undefined
      const row = Math.max(parentRow ?? 0, nextFreeRow.get(column) ?? 0)
      rowOf.set(paneKey, row)
      nextFreeRow.set(column, row + 1)
      rows = Math.max(rows, row + 1)
      maxAgentDepth = Math.max(maxAgentDepth, column)
      nodes.set(paneKey, {
        id: paneKey,
        kind: 'agent',
        x: agentBaseX + column * AGENT_COLUMN,
        y: nodeTop + row * ROW,
        width: PROJECT_MAP_NODE.agentWidth
      })
    }
    const height = LANE_PADDING * 2 + PROJECT_MAP_NODE.height + (rows - 1) * ROW
    lanes.push({ workspaceId: id, x: laneX, y, height })
    y += height + LANE_GAP
  }

  let looseGroup: ProjectMapLayout['looseGroup'] = null
  if (loose.length > 0) {
    y += lanes.length > 0 ? 16 : 0
    const top = y
    loose.forEach((id, index) => {
      nodes.set(id, {
        id,
        kind: 'workspace',
        x: MARGIN + 12 + (index % LOOSE_COLUMNS) * (PROJECT_MAP_NODE.workspaceWidth + 16),
        y: top + 30 + Math.floor(index / LOOSE_COLUMNS) * ROW,
        width: PROJECT_MAP_NODE.workspaceWidth
      })
    })
    const height = 30 + Math.ceil(loose.length / LOOSE_COLUMNS) * ROW
    looseGroup = { y: top, height }
    y = top + height
  }

  const agentRight =
    maxAgentDepth >= 0 ? agentBaseX + maxAgentDepth * AGENT_COLUMN + PROJECT_MAP_NODE.agentWidth : 0
  const looseRight =
    loose.length > 0
      ? MARGIN + 12 + Math.min(loose.length, LOOSE_COLUMNS) * (PROJECT_MAP_NODE.workspaceWidth + 16)
      : 0
  const width =
    Math.max(agentRight, looseRight, agentBaseX + PROJECT_MAP_NODE.agentWidth) + MARGIN + 40

  const wires = graph.edges.flatMap((edge): ProjectMapWire[] => {
    const from = nodes.get(edge.from)
    const to = nodes.get(edge.to)
    if (!from || !to) {
      return []
    }
    return [
      {
        ...edge,
        path: wirePath(
          from.x + from.width,
          from.y + PROJECT_MAP_NODE.pinOffsetY,
          to.x,
          to.y + PROJECT_MAP_NODE.pinOffsetY
        )
      }
    ]
  })
  return { nodes, lanes, wires, looseGroup, width, height: y + MARGIN }
}

/** Horizontal tangents capped at dx keep x monotonic, so a wire stays inside its gutter. */
export function wirePath(x0: number, y0: number, x1: number, y1: number): string {
  const k = Math.max(12, Math.min(Math.abs(x1 - x0) * 0.75, 160))
  return `M${x0} ${y0} C${x0 + k} ${y0} ${x1 - k} ${y1} ${x1} ${y1}`
}

function agentDepths(graph: ProjectMapGraph): Map<string, number> {
  const depths = new Map<string, number>()
  const depthOf = (paneKey: string): number => {
    const known = depths.get(paneKey)
    if (known !== undefined) {
      return known
    }
    const parentKey = graph.agents.get(paneKey)?.parentPaneKey
    const depth = parentKey ? depthOf(parentKey) + 1 : 0
    depths.set(paneKey, depth)
    return depth
  }
  for (const paneKey of graph.agents.keys()) {
    depthOf(paneKey)
  }
  return depths
}

// Roots follow lane order, children follow their parent, so sibling rows never swap places.
function agentDfsOrder(graph: ProjectMapGraph, laneOrder: { id: string }[]): string[] {
  const order: string[] = []
  const visit = (paneKey: string): void => {
    order.push(paneKey)
    for (const childKey of graph.agents.get(paneKey)?.childPaneKeys ?? []) {
      visit(childKey)
    }
  }
  for (const { id } of laneOrder) {
    for (const paneKey of graph.workspaces.get(id)?.agentPaneKeys ?? []) {
      if (!graph.agents.get(paneKey)?.parentPaneKey) {
        visit(paneKey)
      }
    }
  }
  return order
}
