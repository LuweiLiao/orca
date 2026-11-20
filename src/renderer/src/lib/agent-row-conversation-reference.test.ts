import { afterEach, expect, it } from 'vitest'
import { useAppStore } from '@/store'
import type { DashboardAgentRow } from '@/components/dashboard/rows/dashboard-agent-row'
import {
  agentSessionTabFixture,
  terminalTabFixture
} from '@/components/native-chat/surfaces/integration/native-chat-workspace-test-fixtures'
import {
  agentRowConversationReference,
  canReferenceAgentRow
} from './agent-row-conversation-reference'

const original = useAppStore.getState()
afterEach(() => useAppStore.setState(original, true))

function stoppedRow(): DashboardAgentRow {
  return {
    paneKey: 'chat-tab:leaf',
    tab: terminalTabFixture('chat-tab', 'folder:board'),
    agentType: 'claude',
    rowSource: 'live',
    state: 'done',
    startedAt: 100,
    entry: {
      paneKey: 'chat-tab:leaf',
      state: 'done',
      prompt: 'Board layout',
      updatedAt: 200,
      stateStartedAt: 200,
      stateHistory: []
    }
  }
}

it('allows a stopped structured chat without live ownership or provider metadata to be referenced', () => {
  useAppStore.setState({
    unifiedTabsByWorktree: {
      'folder:board': [
        agentSessionTabFixture('chat-tab', 'folder:board', {
          entityId: 'claude_old',
          agentSessionAgent: 'claude',
          executionHostId: 'local'
        })
      ]
    }
  })
  const row = stoppedRow()
  expect(canReferenceAgentRow(row)).toBe(true)
  expect(agentRowConversationReference(row)).toEqual({
    source: { kind: 'structured', sessionId: 'claude_old', workspaceId: 'folder:board' },
    executionHostId: 'local',
    title: 'Board layout'
  })
})

it('does not infer a conversation from a title or let a subagent reference its parent', () => {
  useAppStore.setState({ unifiedTabsByWorktree: {} })
  expect(canReferenceAgentRow(stoppedRow())).toBe(false)
  const child = { ...stoppedRow(), rowSource: 'subagent' as const }
  useAppStore.setState({
    unifiedTabsByWorktree: {
      'folder:board': [
        agentSessionTabFixture('chat-tab', 'folder:board', { executionHostId: 'local' })
      ]
    }
  })
  expect(canReferenceAgentRow(child)).toBe(false)
  expect(agentRowConversationReference(child)).toBeNull()
})

it('keeps the recorded host for a finished remote tab without requiring a running agent', () => {
  useAppStore.setState({
    unifiedTabsByWorktree: {
      'folder:board': [
        agentSessionTabFixture('chat-tab', 'folder:board', {
          entityId: 'claude_remote_tab',
          executionHostId: 'runtime:board'
        })
      ]
    }
  })
  expect(agentRowConversationReference(stoppedRow())).toMatchObject({
    source: { kind: 'structured', sessionId: 'claude_remote_tab' },
    executionHostId: 'runtime:board'
  })
})
