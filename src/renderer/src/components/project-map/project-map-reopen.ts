import { activateAiVaultStructuredSession } from '@/lib/activate-ai-vault-structured-session'
import { forgetProjectMapClosedChat } from '@/lib/project-map-closed-by-map'
import { structuredAgentSessionTargetForHost } from '@/runtime/structured-agent-session-owner'
import type { ProjectMapAgent } from './project-map-graph'

/** Republishes a chat's tab from its record on the host that owns it. */
export async function reopenProjectMapChat(
  agent: Pick<ProjectMapAgent, 'chat' | 'card'>
): Promise<boolean> {
  const { chat, card } = agent
  if (!chat) {
    return false
  }
  const target = structuredAgentSessionTargetForHost(chat.executionHostId)
  const opened = await activateAiVaultStructuredSession(
    { structuredSession: { sessionId: chat.sessionId, workspaceId: card.worktreeId } },
    undefined,
    target ?? undefined
  )
  if (opened) {
    forgetProjectMapClosedChat(chat.sessionId)
  }
  return opened
}
