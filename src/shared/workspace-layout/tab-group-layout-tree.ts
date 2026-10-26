import type { TabGroupLayoutNode } from '../tab-types'

export function buildSplitNode(
  existingGroupId: string,
  newGroupId: string,
  direction: 'horizontal' | 'vertical',
  position: 'first' | 'second'
): TabGroupLayoutNode {
  const existingLeaf: TabGroupLayoutNode = { type: 'leaf', groupId: existingGroupId }
  const newLeaf: TabGroupLayoutNode = { type: 'leaf', groupId: newGroupId }
  return {
    type: 'split',
    direction,
    first: position === 'first' ? newLeaf : existingLeaf,
    second: position === 'second' ? newLeaf : existingLeaf,
    ratio: 0.5
  }
}

export function replaceLeaf(
  root: TabGroupLayoutNode,
  targetGroupId: string,
  replacement: TabGroupLayoutNode
): TabGroupLayoutNode {
  if (root.type === 'leaf') {
    return root.groupId === targetGroupId ? replacement : root
  }
  return {
    ...root,
    first: replaceLeaf(root.first, targetGroupId, replacement),
    second: replaceLeaf(root.second, targetGroupId, replacement)
  }
}

export function updateSplitRatio(
  root: TabGroupLayoutNode,
  path: string[],
  ratio: number
): TabGroupLayoutNode {
  if (path.length === 0) {
    return root.type === 'split' ? { ...root, ratio } : root
  }
  if (root.type !== 'split') {
    return root
  }
  const [segment, ...rest] = path
  if (segment === 'first') {
    return { ...root, first: updateSplitRatio(root.first, rest, ratio) }
  }
  if (segment === 'second') {
    return { ...root, second: updateSplitRatio(root.second, rest, ratio) }
  }
  return root
}

type SplitDirection = Extract<TabGroupLayoutNode, { type: 'split' }>['direction']

// Why: rounding keeps a split, then a close, landing back on exactly the ratio it started from.
function roundRatio(ratio: number): number {
  return Math.round(ratio * 1e6) / 1e6
}

/** Panes a node contributes along `direction`: nested same-direction splits count each pane. */
function paneCount(node: TabGroupLayoutNode, direction: SplitDirection): number {
  return node.type === 'split' && node.direction === direction
    ? paneCount(node.first, direction) + paneCount(node.second, direction)
    : 1
}

function evenRun(node: TabGroupLayoutNode, direction: SplitDirection): TabGroupLayoutNode {
  if (node.type !== 'split' || node.direction !== direction) {
    return node
  }
  const first = paneCount(node.first, direction)
  return {
    ...node,
    first: evenRun(node.first, direction),
    second: evenRun(node.second, direction),
    ratio: roundRatio(first / (first + paneCount(node.second, direction)))
  }
}

/**
 * Sizes every pane in the row or column that holds `groupId` equally, so a new split shares the
 * space with its neighbours instead of halving one of them. Perpendicular branches keep their sizes.
 */
export function distributeTabGroupSplit(
  root: TabGroupLayoutNode,
  groupId: string
): TabGroupLayoutNode {
  const ancestors: Extract<TabGroupLayoutNode, { type: 'split' }>[] = []
  const findPath = (node: TabGroupLayoutNode): boolean => {
    if (node.type === 'leaf') {
      return node.groupId === groupId
    }
    ancestors.push(node)
    if (findPath(node.first) || findPath(node.second)) {
      return true
    }
    ancestors.pop()
    return false
  }
  const parent = findPath(root) ? ancestors.at(-1) : undefined
  if (!parent) {
    return root
  }
  let top = ancestors.length - 1
  while (top > 0 && ancestors[top - 1]!.direction === parent.direction) {
    top--
  }
  const runRoot = ancestors[top]!
  return replaceNode(root, runRoot, evenRun(runRoot, parent.direction))
}

function replaceNode(
  root: TabGroupLayoutNode,
  target: TabGroupLayoutNode,
  replacement: TabGroupLayoutNode
): TabGroupLayoutNode {
  if (root === target) {
    return replacement
  }
  if (root.type === 'leaf') {
    return root
  }
  return {
    ...root,
    first: replaceNode(root.first, target, replacement),
    second: replaceNode(root.second, target, replacement)
  }
}

function findFirstLeaf(root: TabGroupLayoutNode): string {
  return root.type === 'leaf' ? root.groupId : findFirstLeaf(root.first)
}

export function findSiblingGroupId(root: TabGroupLayoutNode, targetGroupId: string): string | null {
  if (root.type === 'leaf') {
    return null
  }
  if (root.first.type === 'leaf' && root.first.groupId === targetGroupId) {
    return root.second.type === 'leaf' ? root.second.groupId : findFirstLeaf(root.second)
  }
  if (root.second.type === 'leaf' && root.second.groupId === targetGroupId) {
    return root.first.type === 'leaf' ? root.first.groupId : findFirstLeaf(root.first)
  }
  return (
    findSiblingGroupId(root.first, targetGroupId) ?? findSiblingGroupId(root.second, targetGroupId)
  )
}

type Extent = Record<SplitDirection, number>

const FULL_EXTENT: Extent = { horizontal: 1, vertical: 1 }

/** Returns the node without dropped leaves and the fraction of its extent still occupied per axis. */
function removeLeavesKeepingProportions(
  node: TabGroupLayoutNode,
  drop: (groupId: string) => boolean
): { node: TabGroupLayoutNode | null; kept: Extent } {
  if (node.type === 'leaf') {
    return drop(node.groupId)
      ? { node: null, kept: { horizontal: 0, vertical: 0 } }
      : { node, kept: FULL_EXTENT }
  }
  const ratio = node.ratio ?? 0.5
  // Why first then second: callers' `drop` may depend on visit order (first placement wins).
  const first = removeLeavesKeepingProportions(node.first, drop)
  const second = removeLeavesKeepingProportions(node.second, drop)
  if (!first.node || !second.node) {
    const survivor = first.node ? first : second
    const share = first.node ? ratio : 1 - ratio
    return survivor.node
      ? {
          node: survivor.node,
          kept: { ...FULL_EXTENT, [node.direction]: share * survivor.kept[node.direction] }
        }
      : { node: null, kept: { horizontal: 0, vertical: 0 } }
  }
  if (first.node === node.first && second.node === node.second) {
    return { node, kept: FULL_EXTENT }
  }
  const firstSize = ratio * first.kept[node.direction]
  const total = firstSize + (1 - ratio) * second.kept[node.direction]
  return {
    node: {
      ...node,
      first: first.node,
      second: second.node,
      ratio: total > 0 ? roundRatio(firstSize / total) : ratio
    },
    kept: { ...FULL_EXTENT, [node.direction]: total }
  }
}

/**
 * Removes the leaves `drop` names (visited first-to-second) and gives their space to the panes in
 * the same row or column in proportion to their sizes, so equal panes stay equal when one closes.
 */
export function removeGroupLayoutLeaves(
  root: TabGroupLayoutNode,
  drop: (groupId: string) => boolean
): TabGroupLayoutNode | null {
  return removeLeavesKeepingProportions(root, drop).node
}

export function removeGroupLayoutLeaf(
  root: TabGroupLayoutNode,
  targetGroupId: string
): TabGroupLayoutNode | null {
  return removeGroupLayoutLeaves(root, (groupId) => groupId === targetGroupId)
}

export function collapseGroupLayout(
  layoutByWorktree: Record<string, TabGroupLayoutNode>,
  activeGroupIdByWorktree: Record<string, string>,
  worktreeId: string,
  groupId: string,
  fallbackGroupId?: string | null
): {
  layoutByWorktree: Record<string, TabGroupLayoutNode>
  activeGroupIdByWorktree: Record<string, string>
} {
  const currentLayout = layoutByWorktree[worktreeId]
  if (!currentLayout) {
    return { layoutByWorktree, activeGroupIdByWorktree }
  }
  const siblingId = findSiblingGroupId(currentLayout, groupId)
  const collapsed = removeGroupLayoutLeaf(currentLayout, groupId)
  const nextLayoutByWorktree = { ...layoutByWorktree }
  if (collapsed) {
    nextLayoutByWorktree[worktreeId] = collapsed
  } else {
    delete nextLayoutByWorktree[worktreeId]
  }
  return {
    layoutByWorktree: nextLayoutByWorktree,
    activeGroupIdByWorktree: {
      ...activeGroupIdByWorktree,
      [worktreeId]: siblingId ?? fallbackGroupId ?? activeGroupIdByWorktree[worktreeId]
    }
  }
}

/** Moves an existing group's leaf to `side` of another group; the moved group keeps its id. */
export function moveGroupLeafBeside(
  root: TabGroupLayoutNode,
  groupId: string,
  besideGroupId: string,
  side: 'left' | 'right' | 'up' | 'down'
): TabGroupLayoutNode {
  const rest = removeGroupLayoutLeaf(root, groupId) ?? { type: 'leaf', groupId: besideGroupId }
  const direction = side === 'left' || side === 'right' ? 'horizontal' : 'vertical'
  const position = side === 'left' || side === 'up' ? 'first' : 'second'
  return replaceLeaf(
    rest,
    besideGroupId,
    buildSplitNode(besideGroupId, groupId, direction, position)
  )
}

function holdsGroup(node: TabGroupLayoutNode, groupId: string): boolean {
  return node.type === 'leaf'
    ? node.groupId === groupId
    : holdsGroup(node.first, groupId) || holdsGroup(node.second, groupId)
}

/**
 * Moves a group's leaf to `side` of the smallest branch holding both `fromGroupId` and
 * `toGroupId` (one group's leaf when they are the same); null when no branch holds both.
 */
export function moveGroupLeafBesideBranch(
  root: TabGroupLayoutNode,
  groupId: string,
  fromGroupId: string,
  toGroupId: string,
  side: 'left' | 'right' | 'up' | 'down'
): TabGroupLayoutNode | null {
  const leaf: TabGroupLayoutNode = { type: 'leaf', groupId }
  const direction = side === 'left' || side === 'right' ? 'horizontal' : 'vertical'
  const leafFirst = side === 'left' || side === 'up'
  const besideBranch = (node: TabGroupLayoutNode): TabGroupLayoutNode | null => {
    if (!holdsGroup(node, fromGroupId) || !holdsGroup(node, toGroupId)) {
      return null
    }
    if (node.type === 'split') {
      const first = besideBranch(node.first)
      if (first) {
        return { ...node, first }
      }
      const second = besideBranch(node.second)
      if (second) {
        return { ...node, second }
      }
    }
    return {
      type: 'split',
      direction,
      first: leafFirst ? leaf : node,
      second: leafFirst ? node : leaf,
      ratio: 0.5
    }
  }
  const rest = removeGroupLayoutLeaf(root, groupId)
  return rest && besideBranch(rest)
}
