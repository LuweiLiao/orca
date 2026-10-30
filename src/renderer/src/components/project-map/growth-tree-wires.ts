import { GROWTH_LAYOUT, type GrowthLayoutPin } from './growth-tree-layout-types'
import type { GrowthTree } from './growth-tree-types'

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** A workspace line, straight down its column from the newest row to where it began. */
export function growthLanePath(x: number, top: number, bottom: number): string {
  return `M${x} ${top} L${x} ${bottom}`
}

/**
 * A derived workspace leaving its parent, gitgraph style: it bends out right above the parent row
 * it came from, then runs straight up its own column to its first chat.
 */
export function growthForkPath(
  parent: { x: number; y: number },
  child: { x: number; y: number }
): string {
  const bend = Math.min(GROWTH_LAYOUT.rowHeight, parent.y - child.y)
  const mid = parent.y - bend / 2
  const end = parent.y - bend
  const curve = `M${parent.x} ${parent.y} C${parent.x} ${mid} ${child.x} ${mid} ${child.x} ${end}`
  return end > child.y ? `${curve} L${child.x} ${child.y}` : curve
}

/**
 * A relation between two chats: within one column it bows out to the right so it never hides
 * under the workspace line; across columns it is an S-curve with vertical ends.
 */
export function growthRelationPath(
  from: { x: number; y: number },
  to: { x: number; y: number }
): string {
  if (from.x === to.x) {
    // Longer spans bow further out, so arcs in one column nest instead of piling up.
    const rows = Math.abs(to.y - from.y) / GROWTH_LAYOUT.rowHeight
    const bow = Math.min(GROWTH_LAYOUT.column * 0.9, 6 + rows * 3)
    return `M${from.x} ${from.y} C${from.x + bow} ${from.y} ${to.x + bow} ${to.y} ${to.x} ${to.y}`
  }
  const mid = (from.y + to.y) / 2
  return `M${from.x} ${from.y} C${from.x} ${mid} ${to.x} ${mid} ${to.x} ${to.y}`
}

/** A relation across two projects is a chip on each end's row, never a long line. */
export function buildGrowthPins(tree: GrowthTree, drawn: ReadonlySet<string>): GrowthLayoutPin[] {
  const grouped = new Map<string, GrowthLayoutPin>()
  const place = (
    kind: 'cross-in' | 'cross-out',
    rowId: string,
    other: string,
    target: string
  ): void => {
    const id = `pin:${kind}:${rowId}:${other}`
    const pin = grouped.get(id) ?? {
      id,
      kind,
      rowId,
      otherProjectId: other,
      targets: []
    }
    pin.targets.push(target)
    grouped.set(id, pin)
  }
  for (const link of tree.crossLinks) {
    if (drawn.has(link.to)) {
      place('cross-in', link.to, link.fromProjectId, link.from)
    }
    if (drawn.has(link.from)) {
      place('cross-out', link.from, link.toProjectId, link.to)
    }
  }
  for (const bar of tree.bars.values()) {
    if (bar.unresolvedSource && drawn.has(bar.id)) {
      const id = `pin:unresolved:${bar.id}`
      grouped.set(id, {
        id,
        kind: 'unresolved',
        rowId: bar.id,
        otherProjectId: null,
        targets: []
      })
    }
  }
  return [...grouped.values()].sort((a, b) => cmp(a.id, b.id))
}
