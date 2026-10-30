import { describe, expect, it } from 'vitest'
import type {
  DashboardCard,
  DashboardSnapshot,
  DashboardWorkspace
} from '../../../../shared/dashboard-snapshot'
import { collapseProjectMapGraph } from './project-map-collapse'
import { buildProjectMapGraph } from './project-map-graph'
import { layoutProjectMap } from './project-map-layout'
import { resolveFlowRoute, type FlowWire } from './project-flow-wire-route'

const wire = (kind: string, from: string, to: string, extra: Partial<FlowWire> = {}): FlowWire => ({
  kind,
  from,
  to,
  path: `${kind}:${from}>${to}`,
  ...extra
})

describe('resolveFlowRoute', () => {
  it('rides the wire forwards for a delegation and backwards for a report', () => {
    const wires = [wire('delegate', 'parent', 'child')]
    expect(resolveFlowRoute(wires, 'parent', 'child')).toEqual({
      path: 'delegate:parent>child',
      reverse: false
    })
    expect(resolveFlowRoute(wires, 'child', 'parent')).toEqual({
      path: 'delegate:parent>child',
      reverse: true
    })
  })

  it('prefers the lineage wire over a reference between the same two chats', () => {
    const wires = [wire('reference', 'parent', 'child'), wire('delegate', 'parent', 'child')]
    expect(resolveFlowRoute(wires, 'parent', 'child')?.path).toBe('delegate:parent>child')
  })

  it('skips a wire that is not drawn, and unrelated or identical ends', () => {
    const hidden = wire('reference', 'a', 'b', { backward: true })
    expect(resolveFlowRoute([hidden], 'a', 'b')).toBeNull()
    expect(resolveFlowRoute([wire('delegate', 'a', 'b')], 'a', 'c')).toBeNull()
    expect(resolveFlowRoute([wire('delegate', 'a', 'a')], 'a', 'a')).toBeNull()
  })
})

describe('resolveFlowRoute for a folded stack', () => {
  const workspace: DashboardWorkspace = {
    repoId: 'repo',
    worktreeId: 'main',
    repoName: 'repo',
    worktreeName: 'main',
    hostKind: 'local',
    executionHostId: 'local',
    workspaceKind: 'worktree'
  }
  const card = (paneKey: string, startedAt: number, parentPaneKey?: string): DashboardCard => ({
    paneKey,
    ptyId: null,
    agentType: 'claude',
    bucket: 'done',
    dotState: 'done',
    task: paneKey,
    repoId: 'repo',
    worktreeId: 'main',
    tabId: `tab-${paneKey}`,
    leafId: null,
    ...(parentPaneKey ? { parentPaneKey } : {}),
    repoName: 'repo',
    worktreeName: 'main',
    startedAt,
    finishedAt: null,
    stateChangedAt: 0,
    unseen: true
  })

  // The canvas's own rule: a chat folded into a stack is drawn as its stack.
  const route = (
    wires: readonly FlowWire[],
    signal: { from: string; to: string; tone: string },
    shownAs: (id: string) => string | null
  ) => {
    const [from, to] = [shownAs(signal.from), shownAs(signal.to)]
    return from && to
      ? resolveFlowRoute(wires, from, to, { handoff: signal.tone === 'handoff' })
      : null
  }

  function shown(workers: number) {
    const snapshot: DashboardSnapshot = {
      generatedAt: 0,
      workspaces: [workspace],
      cards: [
        card('lead', 1),
        ...Array.from({ length: workers }, (_, index) => card(`w${index + 1}`, index + 2, 'lead'))
      ]
    }
    const graph = buildProjectMapGraph(snapshot, 'repo', new Map(), {
      chatsByPaneKey: new Map(),
      lineage: new Map(),
      titleOf: (agent) => agent.task
    })
    const view = collapseProjectMapGraph(graph, new Set())
    const layout = layoutProjectMap(view.graph)
    const shownAs = (id: string): string | null =>
      layout.nodes.has(id) ? id : (view.groupOf.get(id) ?? null)
    return { layout, shownAs }
  }

  it('sends a delegation to a chat folded into a stack along the wire into the stack', () => {
    const { layout, shownAs } = shown(5)
    expect(layout.nodes.has('w2')).toBe(false)
    const out = route(layout.wires, { from: 'lead', to: 'w2', tone: 'delegate' }, shownAs)
    const back = route(layout.wires, { from: 'w2', to: 'lead', tone: 'success' }, shownAs)
    expect(out).toMatchObject({ reverse: false })
    expect(back).toMatchObject({ reverse: true, path: out?.path })
  })

  it('flies two chats in one stack along the same wire, as two signals', () => {
    const { layout, shownAs } = shown(5)
    const first = route(layout.wires, { from: 'lead', to: 'w1', tone: 'delegate' }, shownAs)
    const second = route(layout.wires, { from: 'lead', to: 'w2', tone: 'delegate' }, shownAs)
    expect(first?.path).toBeDefined()
    expect(second?.path).toBe(first?.path)
  })

  it('rides the wire of a chat that is not folded, and nothing for a chat the map does not show', () => {
    const { layout, shownAs } = shown(2)
    expect(
      route(layout.wires, { from: 'lead', to: 'w1', tone: 'delegate' }, shownAs)
    ).not.toBeNull()
    expect(
      route(layout.wires, { from: 'lead', to: 'elsewhere', tone: 'delegate' }, shownAs)
    ).toBeNull()
  })
})
