import type { AgentType } from '../../../../shared/agent-status-types'
import type {
  DashboardBucket,
  DashboardCardDisplayState,
  DashboardCardHostKind,
  DashboardCardWorkspaceKind
} from '../../../../shared/dashboard-snapshot'
import type { ProjectMapAgent, ProjectMapWorkspace } from './project-map-graph'

export type GrowthTreeEdgeKind = 'derive' | 'delegate' | 'handoff' | 'merge'

export const GROWTH_TREE_EDGE_KINDS: readonly GrowthTreeEdgeKind[] = [
  'derive',
  'delegate',
  'handoff',
  'merge'
]

/** Every kind of line the tree draws; a reference is a pointer, so it is not an edge. */
export type GrowthTreeLineKind = GrowthTreeEdgeKind | 'reference'

export const GROWTH_TREE_LINE_KINDS: readonly GrowthTreeLineKind[] = [
  ...GROWTH_TREE_EDGE_KINDS,
  'reference'
]

export type GrowthTreeBar = {
  /** The blueprint's node id for this chat, so a jump lands on the same node. */
  id: string
  projectId: string
  workspaceId: string
  title: string
  agentType: AgentType
  state: DashboardCardDisplayState
  bucket: DashboardBucket
  sessionId: string | null
  /** Epoch ms, clamped into [0, now] and never before its delegator or hand-off source. */
  start: number
  /** Epoch ms; a chat still running ends at now. */
  end: number
  running: boolean
  /** No recorded time: placed from its neighbours. */
  startApprox: boolean
  /** A closed chat a hand-off or reference still connects. */
  history: boolean
  /** The person hid it in the blueprint; the tree keeps it. */
  hiddenInBlueprint: boolean
  /** Its source is known but has no node here and sits in no other project. */
  unresolvedSource: boolean
  agent: ProjectMapAgent
}

export type GrowthTreeLane = {
  id: string
  projectId: string
  name: string
  kind: DashboardCardWorkspaceKind
  hostKind: DashboardCardHostKind
  hostLabel: string | null
  /** Folder workspaces and workspaces whose parent is in another project have none. */
  parentId: string | null
  childIds: string[]
  barIds: string[]
  /** Earliest chat start; null when the workspace has no chats. */
  firstChatAt: number | null
  /**
   * Where the lane begins: when the workspace was made, held to the first chat, else the first
   * chat. Null when the workspace has neither.
   */
  start: number | null
  /** The workspace carries no creation time, so `start` is the first chat's. */
  startApprox: boolean
  workspace: ProjectMapWorkspace
}

export type GrowthTreeProject = {
  id: string
  name: string
  /** Newest chat start or state change; orders the project groups. */
  lastActivity: number
  /** Lanes in drawing order: parents before their derived children. */
  laneIds: string[]
  /** Workspaces with no chats and no chatty descendants, folded into one count. */
  emptyLaneIds: string[]
  chatCount: number
  workingCount: number
}

export type GrowthTreeEdge = {
  id: string
  kind: GrowthTreeEdgeKind
  /** Lane ids for `derive`, bar ids otherwise. */
  from: string
  to: string
  projectId: string
  /** When the relation began, between the two ends' starts. */
  at: number
}

/** A delegation or hand-off whose two chats sit in different projects; drawn as two pins. */
export type GrowthTreeCrossLink = {
  id: string
  kind: Exclude<GrowthTreeEdgeKind, 'derive'>
  from: string
  to: string
  fromProjectId: string
  toProjectId: string
  at: number
}

/** A message in one chat pointed at another conversation; nothing was handed over. */
export type GrowthTreeReference = {
  id: string
  kind: 'reference'
  /** The chat whose message carried the reference. */
  from: string
  /** The conversation it pointed at. */
  to: string
  projectId: string
  /** When the first reference between the two was sent, held inside the carrier's bar. */
  at: number
  /** The newest reference reads its source as it is now rather than as it was. */
  live: boolean
}

export type GrowthTree = {
  now: number
  projects: GrowthTreeProject[]
  lanes: Map<string, GrowthTreeLane>
  bars: Map<string, GrowthTreeBar>
  edges: GrowthTreeEdge[]
  crossLinks: GrowthTreeCrossLink[]
  /** Pointers between chats of one project; kept apart from `edges` so they never shape tracks. */
  references: GrowthTreeReference[]
}
