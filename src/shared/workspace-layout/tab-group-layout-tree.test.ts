import { describe, expect, it } from 'vitest'
import type { TabGroupLayoutNode } from '../tab-types'
import {
  buildSplitNode,
  distributeTabGroupSplit,
  removeGroupLayoutLeaf,
  replaceLeaf
} from './tab-group-layout-tree'

const leaf = (groupId: string): TabGroupLayoutNode => ({ type: 'leaf', groupId })

function splitRight(root: TabGroupLayoutNode, beside: string, added: string): TabGroupLayoutNode {
  return distributeTabGroupSplit(
    replaceLeaf(root, beside, buildSplitNode(beside, added, 'horizontal', 'second')),
    added
  )
}

/** Each pane's share of the width along a horizontal row. */
function widths(node: TabGroupLayoutNode, share = 1): Record<string, number> {
  if (node.type === 'leaf') {
    return { [node.groupId]: share }
  }
  const ratio = node.ratio ?? 0.5
  return { ...widths(node.first, share * ratio), ...widths(node.second, share * (1 - ratio)) }
}

describe('distributeTabGroupSplit', () => {
  it('sizes a third column equally instead of halving the column it split', () => {
    const layout = splitRight(splitRight(leaf('a'), 'a', 'b'), 'b', 'c')
    for (const share of Object.values(widths(layout))) {
      expect(share).toBeCloseTo(1 / 3)
    }
  })

  it('evens the row a split joins but keeps a perpendicular branch as one pane', () => {
    const column: TabGroupLayoutNode = {
      type: 'split',
      direction: 'vertical',
      first: leaf('top'),
      second: leaf('bottom'),
      ratio: 0.7
    }
    const row: TabGroupLayoutNode = {
      type: 'split',
      direction: 'horizontal',
      first: column,
      second: leaf('b'),
      ratio: 0.8
    }
    const layout = splitRight(row, 'b', 'c')
    expect(layout.type === 'split' && layout.ratio).toBeCloseTo(1 / 3)
    expect(layout.type === 'split' && layout.first).toEqual(column)
  })
})

describe('removeGroupLayoutLeaf', () => {
  it('keeps the remaining columns equal when one of three equal columns closes', () => {
    const layout = splitRight(splitRight(leaf('a'), 'a', 'b'), 'b', 'c')
    for (const closed of ['a', 'b', 'c']) {
      const rest = removeGroupLayoutLeaf(layout, closed)!
      for (const share of Object.values(widths(rest))) {
        expect(share).toBeCloseTo(1 / 2)
      }
    }
  })

  it('leaves a row untouched when the closed pane sits in a perpendicular branch', () => {
    const row: TabGroupLayoutNode = {
      type: 'split',
      direction: 'horizontal',
      first: leaf('a'),
      second: { type: 'split', direction: 'vertical', first: leaf('b'), second: leaf('c') },
      ratio: 0.3
    }
    expect(removeGroupLayoutLeaf(row, 'c')).toEqual({ ...row, second: leaf('b') })
  })
})
