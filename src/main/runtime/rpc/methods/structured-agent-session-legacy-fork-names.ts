import type { AgentSessionLineageEntry } from '../../../../shared/agent-session-fork'
import { renameLegacyForkedChats } from '../../../native-chat/agent-session-fork-name'
import type { StructuredAgentSessionHost } from '../../../native-chat/agent-session-wire/structured-agent-session-host'
import type { RpcContext } from '../core'

const legacyNamesRenamed = new WeakSet<object>()

// Once per host: children an older build named "Fork of …" take the hand-off name.
export async function renameLegacyForkedChatsOnce(
  ctx: RpcContext,
  host: StructuredAgentSessionHost,
  entries: readonly AgentSessionLineageEntry[]
): Promise<void> {
  if (legacyNamesRenamed.has(host)) {
    return
  }
  legacyNamesRenamed.add(host)
  try {
    for (const sessionId of await renameLegacyForkedChats(host.deps.store, entries)) {
      const workspaceId = host.deps.store.getRecord(sessionId)?.location.workspaceId
      if (workspaceId) {
        ctx.runtime.refreshStructuredConversationTabTitle(workspaceId, sessionId)
      }
    }
  } catch (error) {
    host.deps.logger.warn('renaming legacy forked chats failed', { scope: 'fork-name', error })
  }
}
