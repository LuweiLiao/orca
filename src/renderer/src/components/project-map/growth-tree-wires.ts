import { wirePath } from './project-map-wires'
import type { GrowthScale } from './growth-tree-scale'
import {
  GROWTH_LAYOUT,
  type GrowthLayoutBar,
  type GrowthLayoutJoin,
  type GrowthLayoutLane,
  type GrowthLayoutPin,
  type GrowthLayoutWire
} from './growth-tree-layout-types'
import type { GrowthTree } from './growth-tree-types'

const JOIN_GAP_PX = 14
const MIN_RUN_PX = 12
const DERIVE_RUN_PX = 36
const PIN_STEP_PX = 16
const PIN_OFFSET_PX = 12

type Input = {
  tree: GrowthTree
  scale: GrowthScale
  lanes: ReadonlyMap<string, GrowthLayoutLane>
  bars: ReadonlyMap<string, GrowthLayoutBar>
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Wires between the drawn chats and lanes. Hand-off and merge sources into one chat meet at a
 * hollow point just left of it. A relation across two projects is two pins, never a long line.
 */
export function buildGrowthWires({ tree, scale, lanes, bars }: Input): {
  wires: GrowthLayoutWire[]
  joins: GrowthLayoutJoin[]
  pins: GrowthLayoutPin[]
} {
  const wires: GrowthLayoutWire[] = []
  const joins: GrowthLayoutJoin[] = []
  const centerY = (box: { y: number; height: number }): number => box.y + box.height / 2
  const incoming = new Map<string, number>()
  for (const edge of tree.edges) {
    if (
      (edge.kind === 'handoff' || edge.kind === 'merge') &&
      bars.has(edge.from) &&
      bars.has(edge.to)
    ) {
      incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1)
    }
  }
  const joined = new Set([...incoming].filter(([, count]) => count >= 2).map(([id]) => id))
  for (const edge of tree.edges) {
    const { id, kind, from, to, projectId } = edge
    if (kind === 'derive') {
      const parent = lanes.get(from)
      const child = lanes.get(to)
      if (parent && child) {
        const x1 = scale.xOf(edge.at)
        const row = (lane: GrowthLayoutLane): number =>
          lane.y + GROWTH_LAYOUT.lanePadding + GROWTH_LAYOUT.trackHeight / 2
        wires.push({
          id,
          kind,
          from,
          to,
          projectId,
          path: wirePath(x1 - DERIVE_RUN_PX, row(parent), x1, row(child))
        })
      }
      continue
    }
    const source = bars.get(from)
    const target = bars.get(to)
    if (!source || !target) {
      continue
    }
    const endX = joined.has(to) && kind !== 'delegate' ? target.x - JOIN_GAP_PX : target.x
    const startX = Math.max(
      source.x,
      Math.min(scale.xOf(edge.at), source.x + source.width, endX - MIN_RUN_PX)
    )
    wires.push({
      id,
      kind,
      from,
      to,
      projectId,
      path: wirePath(startX, centerY(source), endX, centerY(target))
    })
  }
  for (const to of [...joined].sort(cmp)) {
    const target = bars.get(to)!
    const joinId = `join:${to}`
    const y = centerY(target)
    joins.push({ id: joinId, x: target.x - JOIN_GAP_PX, y })
    wires.push({
      id: `joinout:${to}`,
      kind: 'merge',
      from: joinId,
      to,
      projectId: tree.bars.get(to)!.projectId,
      path: wirePath(target.x - JOIN_GAP_PX, y, target.x, y)
    })
  }
  wires.sort((a, b) => cmp(a.id, b.id))
  return { wires, joins, pins: buildPins(tree, bars) }
}

function buildPins(
  tree: GrowthTree,
  bars: ReadonlyMap<string, GrowthLayoutBar>
): GrowthLayoutPin[] {
  const grouped = new Map<string, GrowthLayoutPin>()
  const place = (
    kind: 'cross-in' | 'cross-out',
    barId: string,
    other: string,
    target: string
  ): void => {
    const id = `pin:${kind}:${barId}:${other}`
    const pin = grouped.get(id) ?? {
      id,
      kind,
      barId,
      x: 0,
      y: 0,
      otherProjectId: other,
      targets: []
    }
    pin.targets.push(target)
    grouped.set(id, pin)
  }
  for (const link of tree.crossLinks) {
    if (bars.has(link.to)) {
      place('cross-in', link.to, link.fromProjectId, link.from)
    }
    if (bars.has(link.from)) {
      place('cross-out', link.from, link.toProjectId, link.to)
    }
  }
  for (const bar of tree.bars.values()) {
    if (bar.unresolvedSource && bars.has(bar.id)) {
      grouped.set(`pin:unresolved:${bar.id}`, {
        id: `pin:unresolved:${bar.id}`,
        kind: 'unresolved',
        barId: bar.id,
        x: 0,
        y: 0,
        otherProjectId: null,
        targets: []
      })
    }
  }
  const pins = [...grouped.values()].sort((a, b) => cmp(a.id, b.id))
  const leftCount = new Map<string, number>()
  const rightCount = new Map<string, number>()
  for (const pin of pins) {
    const box = bars.get(pin.barId)!
    const counts = pin.kind === 'cross-out' ? rightCount : leftCount
    const slot = counts.get(pin.barId) ?? 0
    counts.set(pin.barId, slot + 1)
    pin.y = box.y + box.height / 2
    pin.x =
      pin.kind === 'cross-out'
        ? box.x + box.width + PIN_OFFSET_PX + slot * PIN_STEP_PX
        : box.x - PIN_OFFSET_PX - slot * PIN_STEP_PX
  }
  return pins
}
