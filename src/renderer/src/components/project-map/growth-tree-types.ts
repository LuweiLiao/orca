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
  start: number | null
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

export type GrowthTree = {
  now: number
  projects: GrowthTreeProject[]
  lanes: Map<string, GrowthTreeLane>
  bars: Map<string, GrowthTreeBar>
  edges: GrowthTreeEdge[]
  crossLinks: GrowthTreeCrossLink[]
}
