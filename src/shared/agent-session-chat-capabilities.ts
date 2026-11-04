import { z } from 'zod'
import type { AgentSessionSlashCommand } from './agent-session-wire'

export const CHAT_CAPABILITIES_OPTION = 'chatCapabilities'
export const CHAT_CAPABILITIES_MAX_LENGTH = 131072

/** Providers whose conversations can switch Skill and MCP entries per conversation. */
const CHAT_CAPABILITY_PROVIDERS: ReadonlySet<string> = new Set(['claude', 'codex'])

export const AgentSessionChatSelectionSchema = z.object({
  disabledSkills: z.array(z.string()),
  disabledMcpServers: z.array(z.string())
})

export type AgentSessionChatSelection = z.infer<typeof AgentSessionChatSelectionSchema>

/** Why an entry cannot be switched for one conversation; absent when it can. */
export type AgentSessionChatEntryLock = 'plugin' | 'config-disabled' | 'unsupported'

export type AgentSessionChatMcpServer = {
  name: string
  status: string
  locked?: AgentSessionChatEntryLock
}

export type AgentSessionChatCapabilities = {
  selection: AgentSessionChatSelection
  skills: AgentSessionSlashCommand[]
  mcpServers: AgentSessionChatMcpServer[]
}

export function supportsChatCapabilities(provider: string): boolean {
  return CHAT_CAPABILITY_PROVIDERS.has(provider)
}

export function readChatSelection(encoded: string | undefined): AgentSessionChatSelection {
  return encoded
    ? AgentSessionChatSelectionSchema.parse(JSON.parse(encoded))
    : { disabledSkills: [], disabledMcpServers: [] }
}

export function isEmptyChatSelection(selection: AgentSessionChatSelection): boolean {
  return selection.disabledSkills.length === 0 && selection.disabledMcpServers.length === 0
}

/** Order-insensitive: a reordered list is the same launch. */
export function chatSelectionChanged(
  launched: string | undefined,
  requested: string | undefined
): boolean {
  const canonical = (encoded: string | undefined) => {
    const selection = readChatSelection(encoded)
    return JSON.stringify([
      selection.disabledSkills.toSorted(),
      selection.disabledMcpServers.toSorted()
    ])
  }
  return canonical(launched) !== canonical(requested)
}

export function chatCapabilitiesReport(
  provider: string,
  encoded: string | undefined,
  reported: AgentSessionChatCapabilities | undefined
): { chatCapabilities?: AgentSessionChatCapabilities } {
  return supportsChatCapabilities(provider)
    ? {
        chatCapabilities: {
          selection: readChatSelection(encoded),
          skills: reported?.skills ?? [],
          mcpServers: reported?.mcpServers ?? []
        }
      }
    : {}
}
