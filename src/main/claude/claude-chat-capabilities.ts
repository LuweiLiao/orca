import type { Settings } from '@anthropic-ai/claude-agent-sdk'
import {
  CHAT_CAPABILITIES_OPTION,
  chatSelectionChanged,
  readChatSelection
} from '../../shared/agent-session-chat-capabilities'
import type { ClaudeSession } from './claude-structured-session-state'

export function claudeChatCapabilitySettings(
  encoded: string | undefined
): Pick<Settings, 'skillOverrides' | 'deniedMcpServers'> {
  const selection = readChatSelection(encoded)
  return {
    skillOverrides: Object.fromEntries(selection.disabledSkills.map((name) => [name, 'off'])),
    deniedMcpServers: selection.disabledMcpServers.map((serverName) => ({ serverName }))
  }
}

export function claudeChatSelectionRequiresRestart(
  session: Pick<ClaudeSession, 'options'> | undefined,
  options: Readonly<Record<string, string>> | undefined
): boolean {
  return session
    ? chatSelectionChanged(
        session.options.get(CHAT_CAPABILITIES_OPTION),
        options?.[CHAT_CAPABILITIES_OPTION]
      )
    : false
}
