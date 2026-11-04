import type { AgentSessionOptionResult } from '../../../../shared/agent-session-wire'
import {
  CHAT_CAPABILITIES_OPTION,
  type AgentSessionChatSelection
} from '../../../../shared/agent-session-chat-capabilities'
import type { StructuredAgentSessionMutate } from './use-structured-agent-session-mutate'
import type { useStructuredAgentSessionOptionState } from './use-structured-agent-session-option-state'

export function structuredChatCapabilitySelection({
  sessionId,
  mutate,
  beginOptionWrite,
  optionMutationGeneration,
  isCurrentContext,
  setConversationSupport
}: Pick<
  ReturnType<typeof useStructuredAgentSessionOptionState>,
  'beginOptionWrite' | 'optionMutationGeneration' | 'isCurrentContext' | 'setConversationSupport'
> & {
  sessionId: string
  mutate: StructuredAgentSessionMutate
}) {
  return async (selection: AgentSessionChatSelection): Promise<boolean> => {
    const finish = beginOptionWrite(CHAT_CAPABILITIES_OPTION)
    ++optionMutationGeneration.current
    try {
      const result = await mutate<AgentSessionOptionResult>(
        'agentSession.setOption',
        'agentSession.setOption',
        { key: CHAT_CAPABILITIES_OPTION, value: JSON.stringify(selection) }
      )
      if (result && isCurrentContext()) {
        setConversationSupport((current) =>
          current?.sessionId === sessionId && current.chatCapabilities
            ? { ...current, chatCapabilities: { ...current.chatCapabilities, selection } }
            : current
        )
      }
      return Boolean(result)
    } finally {
      finish(true)
    }
  }
}
