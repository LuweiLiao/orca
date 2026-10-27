import type { ConversationReferenceCreate } from '../../../../shared/conversation-reference'
import type { ProjectMapAgent } from './project-map-graph'
import { projectMapAgentTitle } from './project-map-labels'

/** The reference a map node drags into a composer: its structured chat, where it lives. */
export function projectMapConversationReference(
  agent: ProjectMapAgent
): ConversationReferenceCreate | null {
  const { chat, card } = agent
  // Why: SSH chats cannot be read by a reference reader; the composer would refuse them anyway.
  if (!chat || card.hostKind === 'ssh') {
    return null
  }
  return {
    source: { kind: 'structured', sessionId: chat.sessionId, workspaceId: card.worktreeId },
    title: projectMapAgentTitle(card).slice(0, 1024) || chat.agent,
    ...(chat.executionHostId ? { executionHostId: chat.executionHostId } : {})
  }
}
