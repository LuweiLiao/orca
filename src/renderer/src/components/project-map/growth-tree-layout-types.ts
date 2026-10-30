import type { GrowthScale } from './growth-tree-scale'
import type { GrowthTick } from './growth-tree-ticks'
import type { GrowthTreeLineKind } from './growth-tree-types'

export const GROWTH_LAYOUT = {
  top: 8,
  groupHeader: 32,
  groupGap: 10,
  laneGap: 6,
  lanePadding: 6,
  trackHeight: 30,
  barHeight: 22,
  minBarWidth: 24,
  trackGap: 6,
  emptyRow: 24
} as const

export type GrowthBox = { x: number; y: number; width: number; height: number }
export type GrowthLayoutBar = GrowthBox & { id: string; laneId: string; track: number }
export type GrowthLayoutLane = GrowthBox & {
  id: string
  projectId: string
  trackCount: number
  /** World x where the workspace began; null for a workspace with no known start. */
  startX: number | null
  startApprox: boolean
}
export type GrowthLayoutGroup = {
  projectId: string
  y: number
  height: number
  collapsed: boolean
  emptyLaneIds: string[]
  emptyY: number | null
}
export type GrowthLayoutJoin = { id: string; x: number; y: number }
export type GrowthLayoutWire = {
  id: string
  kind: GrowthTreeLineKind
  from: string
  to: string
  projectId: string
  path: string
  /** References only: the newest one reads its source live. */
  live?: true
}
export type GrowthLayoutPin = {
  id: string
  kind: 'cross-in' | 'cross-out' | 'unresolved'
  barId: string
  x: number
  y: number
  otherProjectId: string | null
  /** Bars at the far end; a click jumps to the first. */
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
  scale: GrowthScale
  ticks: readonly GrowthTick[]
  groups: GrowthLayoutGroup[]
  lanes: Map<string, GrowthLayoutLane>
  bars: Map<string, GrowthLayoutBar>
  joins: GrowthLayoutJoin[]
  wires: GrowthLayoutWire[]
  pins: GrowthLayoutPin[]
  paths: GrowthTreePathIndex
}
