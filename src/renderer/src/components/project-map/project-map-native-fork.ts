import { useHostStructuredAgent } from '@/runtime/native-chat/agent-catalogs/use-host-structured-agent'
import { useStructuredAgentSessionHostCapabilityState } from '@/runtime/native-chat/host-capabilities/structured-agent-session-host-capability'
import { callStructuredAgentSession } from '@/runtime/native-chat/requests/structured-agent-session-call'
import { structuredAgentSessionTargetForHost } from '@/runtime/native-chat/session-ownership/structured-agent-session-owner'
import { captureStructuredLaunchSurfaceAddress } from '@/lib/agent-session/launch/structured-agent-session-launch-surface'
import {
  launchNativeChatFork,
  type NativeChatForkOutcome
} from '@/components/native-chat/messages/actions/native-chat-fork-launch'
import { AGENT_SESSION_CREATE_FORK_RUNTIME_CAPABILITY } from '../../../../shared/agent-session/lifecycle/operations/agent-session-create-capabilities'
import type { AgentSessionHistoryResult } from '../../../../shared/agent-session/agent-session-wire'
import { isTuiAgent } from '../../../../shared/agent-launch/catalog/tui-agent-config'
import type { ProjectMapAgent } from './project-map-graph'
import { projectMapLatestForkItemId, projectMapReachableChat } from './project-map-fork-sources'

/** Whether the node can seed a child chat: its host forks and its agent supports forks. */
export function useProjectMapForkable(agent: ProjectMapAgent | undefined): boolean {
  const chat = projectMapReachableChat(agent)
  const target = chat ? structuredAgentSessionTargetForHost(chat.executionHostId) : null
  const host = useStructuredAgentSessionHostCapabilityState(
    target,
    AGENT_SESSION_CREATE_FORK_RUNTIME_CAPABILITY
  )
  const registered = useHostStructuredAgent(target ?? { kind: 'local' }, chat?.agent ?? '')
  return Boolean(chat && target && host === 'supported' && registered?.capabilities.fork)
}

export type ProjectMapForkResult =
  | { kind: 'started'; outcome: NativeChatForkOutcome }
  | { kind: 'no-response' }
  | { kind: 'unavailable' }

/** Forks `source` through its newest response into the clicked node's workspace. */
export async function forkProjectMapChat(input: {
  source: ProjectMapAgent
  origin: ProjectMapAgent
  instruction: string
}): Promise<ProjectMapForkResult> {
  const chat = projectMapReachableChat(input.source)
  const target = chat ? structuredAgentSessionTargetForHost(chat.executionHostId) : null
  if (!chat || !target || !isTuiAgent(chat.agent)) {
    return { kind: 'unavailable' }
  }
  const history = await callStructuredAgentSession<AgentSessionHistoryResult>(
    target,
    'agentSession.history',
    { sessionId: chat.sessionId, direction: 'tail', limit: 200 }
  )
  const throughItemId = history.ok ? projectMapLatestForkItemId(history.page.items) : undefined
  if (!throughItemId) {
    return { kind: 'no-response' }
  }
  const worktreeId = input.origin.card.worktreeId
  const question = input.instruction.trim()
  const outcome = await launchNativeChatFork({
    agent: chat.agent,
    worktreeId,
    target,
    forkFrom: { sessionId: chat.sessionId, throughItemId },
    surfaceAddress: captureStructuredLaunchSurfaceAddress(worktreeId),
    // A first instruction rides the fork the way a side question does.
    ...(question ? { side: { question } } : {})
  })
  return { kind: 'started', outcome }
}
