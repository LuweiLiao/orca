import { describe, expect, it } from 'vitest'
import type {
  AgentStatusOrchestrationContext,
  OrchestrationChatSession
} from '../../../../shared/agent-status-types'
import {
  structuredAgentSessionPaneKey,
  structuredAgentSessionTabId
} from '../../../../shared/structured-agent-session-projection'
import { buildAgentRowLineageTree } from '../dashboard/agent-row-lineage-model'
import { buildWorktreeAgentRows } from './worktree-agent-rows'
import { selectWorktreeAgentOrchestration } from './worktree-agent-orchestration-index'

const chat = (sessionId: string): OrchestrationChatSession => ({
  sessionId,
  worktreeId: 'folder-workspace',
  executionHostId: 'local',
  provider: 'claude',
  conversationName: sessionId,
  model: 'sonnet',
  effort: 'high',
  createdAt: 1000
})
const pane = (id: string) => structuredAgentSessionPaneKey(structuredAgentSessionTabId(id), id)
const context: AgentStatusOrchestrationContext = {
  taskId: 'task',
  dispatchId: 'dispatch',
  dispatchStatus: 'completed',
  parentPaneKey: pane('parent'),
  session: chat('worker'),
  parentSession: chat('parent')
}

describe('conversation-owned sidebar rows', () => {
  it('indexes closed folder chats and retains their parent tree without status or tabs', () => {
    const contexts = selectWorktreeAgentOrchestration(
      {
        tabsByWorktree: {},
        agentStatusByPaneKey: {},
        retainedAgentsByPaneKey: {},
        runtimeAgentOrchestrationByPaneKey: { [pane('worker')]: context }
      },
      'folder-workspace'
    )
    const rows = buildWorktreeAgentRows({
      tabs: [],
      entries: [],
      retained: [],
      runtimeAgentOrchestrationByPaneKey: contexts,
      now: 1_000_000
    })
    const tree = buildAgentRowLineageTree(rows)
    expect(rows).toHaveLength(2)
    expect(tree.rootRows.map((row) => row.paneKey)).toEqual([pane('parent')])
    expect(
      tree.childrenByParentPaneKey
        .get(pane('parent'))
        ?.map((row) => row.structuredSession?.sessionId)
    ).toEqual(['worker'])
    expect(tree.rootRows[0]?.state).toBe('idle')
  })

  it('deduplicates live and durable workers while preserving live activity', () => {
    const rows = buildWorktreeAgentRows({
      tabs: [],
      retained: [],
      now: 2000,
      entries: [
        {
          paneKey: pane('worker'),
          worktreeId: 'folder-workspace',
          state: 'working',
          prompt: 'Review',
          updatedAt: 2000,
          stateStartedAt: 2000,
          stateHistory: []
        }
      ],
      runtimeAgentOrchestrationByPaneKey: {
        [pane('worker')]: { ...context, dispatchStatus: 'dispatched' }
      }
    })
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.paneKey === pane('worker'))).toMatchObject({
      state: 'working',
      structuredSession: chat('worker')
    })
  })
})
