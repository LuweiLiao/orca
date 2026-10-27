import type { ProjectMapEdge, ProjectMapGraph } from './project-map-graph'

export const PROJECT_MAP_NODE = {
  workspaceWidth: 172,
  agentWidth: 224,
  height: 66,
  /** Delegate and derive pins sit on the body row, below the 40px header. */
  pinOffsetY: 53,
  /** Fork pins sit in the header: a fork carries the conversation, not a task. */
  headerPinOffsetY: 20,
  /** Reference pins sit below the delegate pins, so the two never share a point. */
  referencePinOffsetY: 61
} as const

const WORKSPACE_COLUMN = PROJECT_MAP_NODE.workspaceWidth + 44
const AGENT_COLUMN = PROJECT_MAP_NODE.agentWidth + 64
const ROW = PROJECT_MAP_NODE.height + 22
const LANE_GAP = 8
const LANE_PADDING = 12
/** Keeps a stale or hand-edited row from stretching a lane without bound. */
const MAX_PINNED_ROW = 60
const MARGIN = 16
const LOOSE_COLUMNS = 5

/** The grid a chat can be pinned to: its column step, row step and lane inset. */
export const PROJECT_MAP_GRID = {
  agentColumn: AGENT_COLUMN,
  row: ROW,
  laneInset: LANE_PADDING,
  maxRow: MAX_PINNED_ROW
} as const

/** A chat's lane row pinned by the person who placed it, keyed by chat session id. */
export type ProjectMapRowPins = ReadonlyMap<string, number>

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
  /** A reference whose source is right of its target: drawn only while either end is selected. */
  backward?: true
  /** A reference between two chats in one column: an arc in the gutter on their right. */
  side?: true
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
export function layoutProjectMap(
  graph: ProjectMapGraph,
  pins?: ProjectMapRowPins
): ProjectMapLayout {
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
    const taken = new Set<string>()
    const rowOf = new Map<string, number>()
    let rows = 1
    const put = (paneKey: string, column: number, row: number): void => {
      taken.add(`${column}:${row}`)
      rowOf.set(paneKey, row)
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
    const laneAgents = agentsByLane.get(id) ?? []
    // Pinned chats claim their cell first, so unpinned ones flow around them.
    for (const paneKey of laneAgents) {
      const sessionId = graph.agents.get(paneKey)?.chat?.sessionId
      const pinned = sessionId ? pins?.get(sessionId) : undefined
      const column = agentDepth.get(paneKey) ?? 0
      if (
        pinned !== undefined &&
        Number.isInteger(pinned) &&
        pinned >= 0 &&
        pinned <= MAX_PINNED_ROW &&
        !taken.has(`${column}:${pinned}`)
      ) {
        put(paneKey, column, pinned)
      }
    }
    for (const paneKey of laneAgents) {
      if (rowOf.has(paneKey)) {
        continue
      }
      const column = agentDepth.get(paneKey) ?? 0
      const parentKey = graph.agents.get(paneKey)?.parentPaneKey
      // Keep a same-lane chain on its parent's row so clear continuations read as one line.
      const parentRow = parentKey ? rowOf.get(parentKey) : undefined
      let row = Math.max(parentRow ?? 0, nextFreeRow.get(column) ?? 0)
      while (taken.has(`${column}:${row}`)) {
        row++
      }
      nextFreeRow.set(column, row + 1)
      put(paneKey, column, row)
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
    if (edge.kind === 'reference') {
      const y0 = from.y + PROJECT_MAP_NODE.referencePinOffsetY
      const y1 = to.y + PROJECT_MAP_NODE.referencePinOffsetY
      const x0 = from.x + from.width
      if (x0 < to.x) {
        return [{ ...edge, path: wirePath(x0, y0, to.x, y1) }]
      }
      if (from.x === to.x) {
        const x1 = to.x + to.width
        const bulge = 36
        return [
          {
            ...edge,
            path: `M${x0} ${y0} C${x0 + bulge} ${y0} ${x1 + bulge} ${y1} ${x1} ${y1}`,
            side: true
          }
        ]
      }
      return [{ ...edge, path: loopPath(x0, y0, to.x, y1), backward: true }]
    }
    const pinY =
      edge.kind === 'fork' || edge.kind === 'handoff'
        ? PROJECT_MAP_NODE.headerPinOffsetY
        : PROJECT_MAP_NODE.pinOffsetY
    return [
      {
        ...edge,
        path: wirePath(from.x + from.width, from.y + pinY, to.x, to.y + pinY)
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

/** Leaves rightward and enters from the left, so a backward wire still reads source to target. */
function loopPath(x0: number, y0: number, x1: number, y1: number): string {
  return `M${x0} ${y0} C${x0 + 140} ${y0} ${x1 - 140} ${y1} ${x1} ${y1}`
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
