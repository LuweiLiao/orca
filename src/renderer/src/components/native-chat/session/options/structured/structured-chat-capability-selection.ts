import { useCallback } from 'react'
import type { AgentSessionOptionResult } from '../../../../../../../shared/agent-session/agent-session-wire'
import {
  CHAT_CAPABILITIES_OPTION,
  type AgentSessionChatSelection
} from '../../../../../../../shared/agent-session/options/protocol/agent-session-chat-capabilities'
import type { StructuredAgentSessionMutate } from '../../structured/writes/use-structured-agent-session-mutate'

/** Saves a conversation's Skill/MCP selection; the options read that follows shows it. */
export function useStructuredChatCapabilitySelection(
  mutate: StructuredAgentSessionMutate,
  rereadOptions: () => void
): (selection: AgentSessionChatSelection) => Promise<boolean> {
  return useCallback(
    async (selection) => {
      const result = await mutate<AgentSessionOptionResult>(
        'agentSession.setOption',
        'agentSession.setOption',
        { key: CHAT_CAPABILITIES_OPTION, value: JSON.stringify(selection) }
      )
      rereadOptions()
      return result !== null
    },
    [mutate, rereadOptions]
  )
}
