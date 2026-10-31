import { cleanGeneratedCommitMessage } from './commit-message-agent-output'
import { CONVERSATION_SUMMARY_MAX_CHARS } from './conversation-summary'
import { sliceAtCodeUnitLimit } from './surrogate-safe-text-slice'

export type ConversationSummaryMessage = { role: 'user' | 'assistant' | 'tool'; text: string }

const MAX_TRANSCRIPT_CHARS = 60_000
const MAX_MESSAGE_CHARS = 2_000

/** The summary request's first line; Session History reads it to hide these one-shot runs. */
export const CONVERSATION_SUMMARY_PROMPT_OPENING =
  'Summarize this chat so a new chat can continue it.'

/** Newest messages first into the budget, so a long chat loses its oldest turns, not its latest. */
export function conversationSummaryTranscript(
  messages: readonly ConversationSummaryMessage[],
  budget = MAX_TRANSCRIPT_CHARS
): {
  text: string
  omitted: number
} {
  const lines: string[] = []
  let used = 0
  let kept = 0
  for (const message of messages.toReversed()) {
    const label =
      message.role === 'user' ? 'User' : message.role === 'assistant' ? 'Assistant' : 'Tool'
    const line = `${label}: ${sliceAtCodeUnitLimit(message.text.trim(), MAX_MESSAGE_CHARS)}`
    if (used + line.length > budget && kept > 0) {
      break
    }
    lines.push(line)
    used += line.length
    kept += 1
  }
  return { text: lines.toReversed().join('\n\n'), omitted: messages.length - kept }
}

export function buildConversationSummaryPrompt(
  messages: readonly ConversationSummaryMessage[],
  customPrompt = ''
): string {
  const { text, omitted } = conversationSummaryTranscript(messages)
  const base = `${CONVERSATION_SUMMARY_PROMPT_OPENING}
Write plain text: the goal, decisions made, the current state, and what is left to do.
Keep file paths, commands, and names exact. Do not invent anything the chat does not show.
Output only the summary, with no preamble.
${omitted > 0 ? `\nThe ${omitted} oldest messages are not shown.\n` : ''}
Chat:
${text}`
  const extra = customPrompt.trim()
  return extra ? `${base}\n\nAdditional instructions:\n${extra}` : base
}

/** The first line of the request a hand-off child's summary is generated from. */
export const CONVERSATION_HANDOFF_PROMPT_OPENING =
  'Summarize these chats into one hand-off so a new chat can continue their work.'

/**
 * The summary a hand-off child starts from. One chat reuses the summary prompt; several share the
 * transcript budget equally and are summarized together, since the child continues all of them.
 */
export function buildConversationHandoffSummaryPrompt(
  sections: readonly { label: string | null; messages: readonly ConversationSummaryMessage[] }[],
  customPrompt = ''
): string {
  if (sections.length === 1) {
    return buildConversationSummaryPrompt(sections[0]!.messages, customPrompt)
  }
  const share = Math.floor(MAX_TRANSCRIPT_CHARS / Math.max(1, sections.length))
  const chats = sections.map((section, index) => {
    const { text, omitted } = conversationSummaryTranscript(section.messages, share)
    return [
      `## Chat ${index + 1} of ${sections.length}${section.label ? `: ${section.label}` : ''}`,
      ...(omitted > 0 ? [`(The ${omitted} oldest messages are not shown.)`] : []),
      text
    ].join('\n')
  })
  const base = `${CONVERSATION_HANDOFF_PROMPT_OPENING}
Write plain text: the shared goal, what each chat decided and found, the current state, and what is left to do.
Keep file paths, commands, and names exact. Do not invent anything the chats do not show.
Output only the summary, with no preamble.

${chats.join('\n\n')}`
  const extra = customPrompt.trim()
  return extra ? `${base}\n\nAdditional instructions:\n${extra}` : base
}

export function sanitizeGeneratedConversationSummary(raw: string): string | null {
  const cleaned = cleanGeneratedCommitMessage(raw).trim()
  if (!cleaned || cleaned.startsWith('<think>') || cleaned.startsWith('◁think▷')) {
    return null
  }
  return sliceAtCodeUnitLimit(cleaned, CONVERSATION_SUMMARY_MAX_CHARS)
}
