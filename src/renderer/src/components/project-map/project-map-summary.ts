import type { ProjectMapActionBlock } from './project-map-node-actions'
import type { ProjectMapAgent } from './project-map-graph'
import {
  conversationReferenceToken,
  withConversationReferenceInstructions,
  type ConversationReference
} from '../../../../shared/conversation-reference'
import { projectMapAgentForkable } from './project-map-window-subject'

/** Why a chat's summary cannot be made or read here; null when it can. */
export function projectMapSummaryBlock(
  agent: ProjectMapAgent,
  hostTooOld: boolean
): ProjectMapActionBlock | null {
  if (!agent.chat) {
    return 'no-chat'
  }
  if (!projectMapAgentForkable(agent)) {
    return 'remote-host'
  }
  return hostTooOld ? 'summary-host-too-old' : null
}

/** The first message of a handoff: a summary if one is used, the person's words, then references. */
export function projectMapHandoffInstruction(input: {
  summary: string | null
  instruction: string
  references: readonly ConversationReference[]
}): string {
  const own =
    input.references.length === 0
      ? input.instruction
      : withConversationReferenceInstructions(
          [input.instruction.trim(), input.references.map(conversationReferenceToken).join(' ')]
            .filter(Boolean)
            .join('\n\n')
        )
  const summary = input.summary?.trim()
  if (!summary) {
    return own
  }
  const head = `Summary of the previous chat:\n\n${summary}`
  return own.trim() ? `${head}\n\n${own.trim()}` : head
}
