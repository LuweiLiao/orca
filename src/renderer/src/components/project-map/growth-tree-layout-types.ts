import type { GrowthTreeLineKind } from './growth-tree-types'

export const GROWTH_LAYOUT = {
  top: 4,
  groupHeader: 34,
  groupGap: 8,
  rowHeight: 30,
  /** Distance between two workspace columns. */
  column: 24,
  /** Left of the first column. */
  graphPadding: 14,
  dotRadius: 5,
  /** Room between the last column and the row text. */
  textGap: 10,
  minGraphWidth: 44
} as const

/** Lane colours cycle through this many CSS variables (`--gt-lane-0` …). */
export const GROWTH_LANE_COLORS = 6

export type GrowthBox = { x: number; y: number; width: number; height: number }

/** One line of the tree: a chat, or a workspace with no chats that still leads somewhere. */
export type GrowthLayoutRow = {
  id: string
  kind: 'chat' | 'lane'
  laneId: string
  /** Top of the row. */
  y: number
  /** Centre of the dot, in the graph column of the lane. */
  cx: number
  cy: number
  /** The lane's newest row carries the workspace label, like a branch tip. */
  tip: boolean
}

export type GrowthLayoutLane = {
  id: string
  projectId: string
  column: number
  color: number
  x: number
  /** The drawn line, newest end first; null while no row of the lane is shown. */
  top: number | null
  bottom: number | null
}

export type GrowthLayoutGroup = {
  projectId: string
  y: number
  height: number
  collapsed: boolean
  emptyLaneIds: string[]
}

export type GrowthLayoutWire = {
  id: string
  kind: GrowthTreeLineKind
  from: string
  to: string
  projectId: string
  path: string
  /** Derive lines are drawn in the child lane's colour. */
  color?: number
  /** References only: the newest one reads its source live. */
  live?: true
}

export type GrowthLayoutPin = {
  id: string
  kind: 'cross-in' | 'cross-out' | 'unresolved'
  rowId: string
  otherProjectId: string | null
  /** Chats at the far end; a click jumps to the first. */
  targets: string[]
}

/** World coordinates by id, for a layer drawn over the tree (signal particles ride the paths). */
export type GrowthTreePathIndex = {
  nodes: ReadonlyMap<string, GrowthBox>
  edges: ReadonlyMap<string, string>
  /** The drawn wires with their two ends, so a signal can find the one joining its nodes. */
  wires: readonly GrowthLayoutWire[]
}

export type GrowthLayout = {
  width: number
  height: number
  /** Where the row text begins; everything left of it is the graph. */
  textX: number
  groups: GrowthLayoutGroup[]
  lanes: Map<string, GrowthLayoutLane>
  /** Drawn rows only, in top-to-bottom order. */
  rows: Map<string, GrowthLayoutRow>
  wires: GrowthLayoutWire[]
  pins: GrowthLayoutPin[]
  paths: GrowthTreePathIndex
}
