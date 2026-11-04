import { z } from 'zod'
import type { AgentSessionSlashCommand } from './agent-session-wire'

export const CHAT_CAPABILITIES_OPTION = 'chatCapabilities'
export const CHAT_CAPABILITIES_MAX_LENGTH = 131072

export const AgentSessionChatSelectionSchema = z.object({
  disabledSkills: z.array(z.string()),
  disabledMcpServers: z.array(z.string())
})

export type AgentSessionChatSelection = z.infer<typeof AgentSessionChatSelectionSchema>

export type AgentSessionChatCapabilities = {
  selection: AgentSessionChatSelection
  skills: AgentSessionSlashCommand[]
  mcpServers: { name: string; status: string }[]
}

export function readChatSelection(encoded: string | undefined): AgentSessionChatSelection {
  return encoded
    ? AgentSessionChatSelectionSchema.parse(JSON.parse(encoded))
    : { disabledSkills: [], disabledMcpServers: [] }
}

export function chatCapabilitiesReport(
  provider: string,
  encoded: string | undefined,
  reported: AgentSessionChatCapabilities | undefined
): { chatCapabilities?: AgentSessionChatCapabilities } {
  return provider === 'claude'
    ? {
        chatCapabilities: {
          selection: readChatSelection(encoded),
          skills: reported?.skills ?? [],
          mcpServers: reported?.mcpServers ?? []
        }
      }
    : {}
}
