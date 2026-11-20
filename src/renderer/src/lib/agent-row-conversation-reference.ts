import type React from 'react'
import { writeConversationReferenceDrag } from './conversation-reference-drag'
import {
  getConnectionExecutionHostId,
  toRuntimeExecutionHostId
} from '../../../shared/execution-host/execution-host'
import { isAiVaultAgent } from '../../../shared/ai-vault/contracts/ai-vault-types'
import { getAgentRowPrimaryText } from '../../../shared/agent-status/presentation/agent-row-primary-text'
import type { ConversationReferenceCreate } from '../../../shared/conversation-reference'
import type { DashboardAgentRow } from '@/components/dashboard/rows/dashboard-agent-row'
import { structuredChatTabById } from './agent-session/tab-identity/structured-chat-tab-index'
import { structuredAgentSessionOwnerForTab } from '@/runtime/native-chat/session-ownership/structured-agent-session-owner'
import { runtimeEnvironmentIdOrLocalUnlessTwin } from './workspace/ownership/worktree-runtime-owner'
import { useAppStore } from '@/store'

/** Finished chats retain their conversation identity after live execution ownership ends. */
export function canReferenceAgentRow(row: DashboardAgentRow): boolean {
  return agentRowConversationReference(row) !== null
}

export function agentRowConversationReference(
  row: DashboardAgentRow,
  title?: string
): ConversationReferenceCreate | null {
  if (row.rowSource === 'subagent') {
    return null
  }
  const state = useAppStore.getState()
  const tab = structuredChatTabById(state.unifiedTabsByWorktree, row.tab.worktreeId, row.tab.id)
  const label = (title || getAgentRowPrimaryText(row.entry) || row.agentType).slice(0, 1024)
  if (tab) {
    const owner = structuredAgentSessionOwnerForTab(state, tab)
    if (!owner) {
      return null
    }
    return {
      source: { kind: 'structured', sessionId: tab.entityId, workspaceId: tab.worktreeId },
      title: label,
      executionHostId: owner
    }
  }
  const provider = row.entry.providerSession
  if (!provider || !isAiVaultAgent(row.agentType)) {
    return null
  }
  const environment = runtimeEnvironmentIdOrLocalUnlessTwin(state, row.tab.worktreeId)
  return {
    source: { kind: 'transcript', agent: row.agentType, sessionId: provider.id },
    title: label,
    executionHostId: environment
      ? toRuntimeExecutionHostId(environment)
      : getConnectionExecutionHostId(row.entry.connectionId)
  }
}

/** An agent row dragged into a chat's message box references its conversation; refused otherwise. */
export function startAgentRowReferenceDrag(
  event: React.DragEvent<HTMLElement>,
  row: DashboardAgentRow,
  title: string,
  blocked: boolean
): void {
  const reference = blocked ? null : agentRowConversationReference(row, title)
  if (!reference) {
    event.preventDefault()
    return
  }
  writeConversationReferenceDrag(event.dataTransfer, reference)
}
