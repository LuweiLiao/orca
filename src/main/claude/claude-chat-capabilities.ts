import type { Settings } from '@anthropic-ai/claude-agent-sdk'
import { readChatSelection } from '../../shared/agent-session-chat-capabilities'
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
  if (!session) {
    return false
  }
  const canonical = (encoded: string | undefined) => {
    const selection = readChatSelection(encoded)
    return JSON.stringify([
      selection.disabledSkills.toSorted(),
      selection.disabledMcpServers.toSorted()
    ])
  }
  return canonical(session.options.get('chatCapabilities')) !== canonical(options?.chatCapabilities)
}
