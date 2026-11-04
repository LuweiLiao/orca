import type { NativeChatMessage } from '../../../../shared/native-chat-types'

export type NativeChatCapabilityUse = { count: number; messageId: string }

export function nativeChatCapabilityUsage(messages: readonly NativeChatMessage[]) {
  const skills = new Map<string, NativeChatCapabilityUse>()
  const mcpServers = new Map<string, NativeChatCapabilityUse>()
  const seen = new Set<string>()
  for (const message of messages) {
    for (const [index, block] of message.blocks.entries()) {
      if (block.type !== 'tool-call') {
        continue
      }
      const key = block.callId ?? `${message.id}:${index}`
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      const server = block.mcpIdentity?.server ?? /^mcp__(.+?)__/.exec(block.name)?.[1]
      const input = typeof block.input === 'object' && block.input !== null ? block.input : null
      const skill =
        block.name.toLowerCase() === 'skill' &&
        input &&
        'skill' in input &&
        typeof input.skill === 'string'
          ? input.skill
          : null
      const name = server ?? skill
      if (!name) {
        continue
      }
      const group = server ? mcpServers : skills
      group.set(name, { count: (group.get(name)?.count ?? 0) + 1, messageId: message.id })
    }
  }
  return { skills, mcpServers }
}
