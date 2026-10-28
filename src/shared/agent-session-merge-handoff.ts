// A child merged from several chats: each chat's messages in its own section, the hand-off budget
// shared so a short chat comes over whole and a long one keeps its newest messages.

import {
  HANDOFF_ACKNOWLEDGE,
  HANDOFF_UNTRUSTED_NOTE,
  MAX_CONVERSATION_HANDOFF_CHARS,
  getMarkdownFenceForTranscript,
  handoffBlocks,
  handoffMessagesWithinBudget,
  type AgentSessionHandoffMessage
} from './agent-session-fork-context'

/** Room each section's heading, counts and reference line take, kept out of the message budget. */
const SECTION_OVERHEAD_CHARS = 600

export type AgentSessionMergeHandoffSource = {
  messages: readonly AgentSessionHandoffMessage[]
  sourceLabel?: string | null
  agentLabel?: string | null
  /** A reference the child can read this chat's left-out earlier messages through. */
  sourceReference?: string | null
}

/**
 * Max-min fair shares of `total`: each demand gets what it asks for, or an equal share of what is
 * left when it asks for more, so no source is cut while a smaller one could have given way.
 */
export function shareHandoffBudget(demands: readonly number[], total: number): number[] {
  const shares = demands.map(() => 0)
  let remaining = total
  const order = demands
    .map((demand, index) => ({ demand, index }))
    .sort((a, b) => a.demand - b.demand)
  order.forEach(({ demand, index }, position) => {
    const share = Math.min(demand, Math.floor(remaining / (order.length - position)))
    shares[index] = share
    remaining -= share
  })
  return shares
}

/** The child's first message for a merge; null when no source says anything. */
export function buildAgentSessionMergeHandoffPrompt(input: {
  sources: readonly AgentSessionMergeHandoffSource[]
  instruction?: string | null
}): { text: string; handedOver: number[]; totals: number[] } | null {
  const blocks = input.sources.map((source) => handoffBlocks(source.messages))
  if (blocks.every((list) => list.length === 0)) {
    return null
  }
  const budget = Math.max(
    0,
    MAX_CONVERSATION_HANDOFF_CHARS - SECTION_OVERHEAD_CHARS * (input.sources.length + 1)
  )
  const shares = shareHandoffBudget(
    blocks.map((list) => list.reduce((sum, block) => sum + block.length + 2, 0)),
    budget
  )
  const handedOver: number[] = []
  const sections = input.sources.flatMap((source, index) => {
    const list = blocks[index]!
    if (list.length === 0) {
      handedOver.push(0)
      return []
    }
    const { transcript, omitted } = handoffMessagesWithinBudget(list, shares[index]!)
    handedOver.push(list.length - omitted)
    const fence = getMarkdownFenceForTranscript(transcript)
    return [
      `## Source ${index + 1} of ${input.sources.length}${source.sourceLabel ? `: ${source.sourceLabel}` : ''}`,
      ...(source.agentLabel ? [`Original agent: ${source.agentLabel}`] : []),
      `Messages handed over: ${list.length - omitted} of ${list.length}`,
      ...(omitted > 0
        ? [
            `The earliest ${omitted} messages did not fit and are left out.${
              source.sourceReference
                ? ` Read them from that conversation when you need them: ${source.sourceReference}`
                : ''
            }`
          ]
        : []),
      '',
      `${fence}text`,
      transcript,
      fence,
      ''
    ]
  })
  const text = [
    `This conversation continues from ${input.sources.length} other Orca conversations, merged. Their messages below are your background context; this is a new, independent conversation. Each section is one conversation, the first being the one this continues most directly.`,
    '',
    ...sections,
    HANDOFF_UNTRUSTED_NOTE,
    'The conversations may come from other workspaces, so file paths in them can differ from yours.',
    '',
    input.instruction?.trim() || HANDOFF_ACKNOWLEDGE
  ].join('\n')
  return { text, handedOver, totals: blocks.map((list) => list.length) }
}
