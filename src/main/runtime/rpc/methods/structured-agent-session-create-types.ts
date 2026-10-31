import type { StructuredAgentSessionHost } from '../../../native-chat/agent-session-wire/structured-agent-session-host'
import type { AgentSessionAttachParams } from '../../../native-chat/agent-session-wire/structured-agent-session-attach'
import type { StructuredAgentSessionCreateOptions } from '../../../native-chat/agent-session-wire/structured-agent-session-create'
import type { StructuredAgentId } from '../../../../shared/agent-session-provider-handle'
import type { StructuredAgentSessionFirstMessage } from '../../../../shared/structured-agent-session-create'

export type PreparedStructuredAgentSessionCreate = {
  host: StructuredAgentSessionHost
  attachParams: AgentSessionAttachParams
  hostLaunchDirectory?: string
  catalogModels?: StructuredAgentSessionCreateOptions['catalogModels']
  /** Null when the caller supplied its own location; only a resolved worktree publishes a tab. */
  tab: { workspaceId: string; agent: StructuredAgentId } | null
  /** Absent for older clients and provider-dependent in-process callers. */
  atRest?: { firstMessage?: StructuredAgentSessionFirstMessage }
}
