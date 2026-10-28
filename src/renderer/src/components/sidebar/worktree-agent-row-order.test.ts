import { describe, expect, it } from 'vitest'
import type { DashboardAgentRow } from '@/components/dashboard/useDashboardData'
import { buildAgentRowLineageTree } from '@/components/dashboard/agent-row-lineage-model'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import { compareWorktreeAgentRows, orderWorktreeAgentRows } from './worktree-agent-row-order'

function row(
  paneKey: string,
  startedAt: number,
  entry: Partial<AgentStatusEntry> = {}
): DashboardAgentRow {
  return {
    paneKey,
    entry: {
      paneKey,
      state: 'done',
      prompt: paneKey,
      updatedAt: startedAt,
      stateStartedAt: startedAt,
      stateHistory: [],
      ...entry
    },
    tab: {
      id: `tab-${paneKey}`,
      worktreeId: 'wt',
      ptyId: null,
      title: paneKey,
      customTitle: null,
      color: null,
      sortOrder: 0,
      createdAt: startedAt
    },
    agentType: 'claude',
    state: 'done',
    startedAt
  }
}

function worker(parentPaneKey: string, n: number): AgentStatusEntry['orchestration'] {
  return { parentPaneKey, taskId: `task-${n}`, dispatchId: `ctx-${n}` }
}

const rows = [
  row('a', 1),
  // Started second but reported a state change most recently.
  row('b', 2, { stateStartedAt: 50, updatedAt: 50 }),
  row('c', 3, { updatedAt: 99 }),
  row('a-child', 4, { orchestration: worker('a', 1) }),
  row('a-child-2', 5, { orchestration: worker('a', 2) })
].toSorted(compareWorktreeAgentRows)

function shape(order: 'activity' | 'newest' | 'oldest') {
  const tree = buildAgentRowLineageTree(orderWorktreeAgentRows(rows, order))
  return {
    roots: tree.rootRows.map((r) => r.paneKey),
    children: tree.childrenByParentPaneKey.get('a')?.map((r) => r.paneKey)
  }
}

describe('orderWorktreeAgentRows', () => {
  it('keeps start order for oldest first', () => {
    expect(shape('oldest')).toEqual({ roots: ['a', 'b', 'c'], children: ['a-child', 'a-child-2'] })
  })

  it('puts the newest agents first and keeps children under their parent', () => {
    expect(shape('newest')).toEqual({ roots: ['c', 'b', 'a'], children: ['a-child-2', 'a-child'] })
  })

  it('ranks by the last state change, ignoring tool-ping updatedAt bumps', () => {
    expect(shape('activity').roots).toEqual(['b', 'c', 'a'])
  })
})
