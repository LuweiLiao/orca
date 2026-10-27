import { describe, expect, it } from 'vitest'
import type { DashboardCard, DashboardWorkspace } from '../../../../shared/dashboard-snapshot'
import { projectMapDropSlot } from './project-map-drop-slot'
import { buildProjectMapGraph, type ProjectMapGraph } from './project-map-graph'
import { layoutProjectMap, PROJECT_MAP_GRID, PROJECT_MAP_NODE } from './project-map-layout'

function workspace(id: string, parent?: string): DashboardWorkspace {
  return {
    repoId: 'repo',
    worktreeId: id,
    repoName: 'repo',
    worktreeName: id,
    ...(parent ? { parentWorktreeId: parent } : {}),
    hostKind: 'local',
    executionHostId: 'local',
    workspaceKind: 'worktree'
  }
}

function card(paneKey: string, worktreeId: string, parentPaneKey?: string): DashboardCard {
  return {
    paneKey,
    ptyId: null,
    agentType: 'claude',
    bucket: 'done',
    dotState: 'done',
    task: paneKey,
    repoId: 'repo',
    worktreeId,
    tabId: `tab-${paneKey}`,
    leafId: null,
    ...(parentPaneKey ? { parentPaneKey } : {}),
    repoName: 'repo',
    worktreeName: worktreeId,
    startedAt: Number(paneKey.replace(/\D/g, '')) || 0,
    finishedAt: null,
    stateChangedAt: 0,
    unseen: false
  }
}

function graphOf(workspaces: DashboardWorkspace[], cards: DashboardCard[]): ProjectMapGraph {
  const graph = buildProjectMapGraph({ generatedAt: 0, cards, workspaces }, 'repo')
  for (const [paneKey, agent] of graph.agents) {
    agent.chat = { sessionId: `s-${paneKey}`, agent: 'claude', executionHostId: 'local' }
  }
  return graph
}

// o1 has two delegates in column 1 (rows 0 and 1); a second lane has a chat in the same column.
const crowded = (): ProjectMapGraph =>
  graphOf(
    [workspace('main'), workspace('next', 'main')],
    [
      card('o1', 'main'),
      card('d1', 'main', 'o1'),
      card('d2', 'main', 'o1'),
      card('n1', 'next'),
      card('n2', 'next', 'n1')
    ]
  )

const { row: ROW, laneInset } = PROJECT_MAP_GRID
const centerOf = (top: number): number => top + PROJECT_MAP_NODE.height / 2

describe('project map drop slot', () => {
  it('snaps right of the origin onto the free row nearest the pointer, or to nothing when none is free', () => {
    const graph = crowded()
    const layout = layoutProjectMap(graph)
    const lane = layout.lanes[0]
    const top = lane.y + laneInset
    const slot = projectMapDropSlot(layout, graph, 'o1', centerOf(top + 0.4 * ROW))
    // Row 0 is the nearest row, but d1 holds it; row 1 holds d2; row 2 would sit on n2's lane.
    expect(slot).toBeNull()

    const roomy = graphOf(
      [workspace('main')],
      [card('o1', 'main'), card('d1', 'main', 'o1'), card('d2', 'main', 'o1')]
    )
    const roomyLayout = layoutProjectMap(roomy)
    const roomyTop = roomyLayout.lanes[0].y + laneInset
    const below = projectMapDropSlot(roomyLayout, roomy, 'o1', centerOf(roomyTop + 5 * ROW))
    expect(below).toEqual({
      row: 2,
      x: roomyLayout.nodes.get('o1')!.x + PROJECT_MAP_GRID.agentColumn,
      y: roomyTop + 2 * ROW
    })
    expect(below?.x).toBe(roomyLayout.nodes.get('d1')!.x)
  })

  it('never overlaps a node, wherever the pointer is', () => {
    const graph = graphOf(
      [workspace('main'), workspace('next', 'main')],
      [card('o1', 'main'), card('d1', 'main', 'o1'), card('n1', 'next'), card('n2', 'next', 'n1')]
    )
    const layout = layoutProjectMap(graph)
    for (let pointerY = -50; pointerY < layout.height + 50; pointerY += 17) {
      const slot = projectMapDropSlot(layout, graph, 'o1', pointerY)
      if (!slot) {
        continue
      }
      for (const node of layout.nodes.values()) {
        const apart =
          node.x >= slot.x + PROJECT_MAP_NODE.agentWidth ||
          slot.x >= node.x + node.width ||
          node.y >= slot.y + PROJECT_MAP_NODE.height ||
          slot.y >= node.y + PROJECT_MAP_NODE.height
        expect(apart).toBe(true)
      }
    }
  })

  it('returns null when the origin is not an agent on the map', () => {
    const graph = crowded()
    expect(projectMapDropSlot(layoutProjectMap(graph), graph, 'main', 0)).toBeNull()
  })
})

describe('project map row pins', () => {
  it('lays out exactly as before when nothing is pinned', () => {
    const graph = crowded()
    const plain = layoutProjectMap(graph)
    for (const pins of [undefined, new Map<string, number>(), new Map([['unknown', 3]])]) {
      const pinned = layoutProjectMap(graph, pins)
      expect(pinned.nodes).toEqual(plain.nodes)
      expect(pinned.lanes).toEqual(plain.lanes)
      expect(pinned.wires).toEqual(plain.wires)
      expect(pinned.height).toBe(plain.height)
    }
  })

  it('puts a pinned chat on its row and flows the others around it', () => {
    const graph = crowded()
    const plain = layoutProjectMap(graph)
    const pinned = layoutProjectMap(graph, new Map([['s-d2', 0]]))
    const top = pinned.lanes[0].y + laneInset
    expect(pinned.nodes.get('d2')?.y).toBe(top)
    // d1 loses row 0 to the pin and moves down; the column stays free of overlaps.
    expect(pinned.nodes.get('d1')?.y).toBe(top + ROW)
    expect(new Set([pinned.nodes.get('d1')?.y, pinned.nodes.get('d2')?.y]).size).toBe(2)
    expect(pinned.nodes.get('o1')).toEqual(plain.nodes.get('o1'))
  })

  it('grows the lane to hold a pin below its last row', () => {
    const graph = crowded()
    const plain = layoutProjectMap(graph)
    const pinned = layoutProjectMap(graph, new Map([['s-d1', 4]]))
    expect(pinned.lanes[0].height).toBe(plain.lanes[0].height + 3 * ROW)
    expect(pinned.nodes.get('d1')?.y).toBe(pinned.lanes[0].y + laneInset + 4 * ROW)
  })

  it('moves a pin that lands on an already pinned cell to the next free row', () => {
    const graph = crowded()
    const layout = layoutProjectMap(
      graph,
      new Map([
        ['s-d1', 2],
        ['s-d2', 2]
      ])
    )
    const top = layout.lanes[0].y + laneInset
    expect(layout.nodes.get('d1')?.y).toBe(top + 2 * ROW)
    expect(layout.nodes.get('d2')?.y).not.toBe(layout.nodes.get('d1')?.y)
  })

  it('ignores pins that are not rows', () => {
    const graph = crowded()
    const plain = layoutProjectMap(graph)
    const odd = layoutProjectMap(
      graph,
      new Map([
        ['s-d1', -1],
        ['s-d2', 1.5],
        ['s-n2', 100000]
      ])
    )
    expect(odd.nodes).toEqual(plain.nodes)
  })
})
