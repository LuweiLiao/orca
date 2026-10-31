// The first message of a hand-off child, as text the agent reads and the chat recognizes, so the
// chat can show a "hand-off" divider and fold the carried context instead of a wall of text.

import {
  HANDOFF_ACKNOWLEDGE,
  HANDOFF_UNTRUSTED_NOTE,
  getMarkdownFenceForTranscript
} from './agent-session-fork-context'

export const HANDOFF_SUMMARY_OPENING =
  'This conversation continues from another Orca conversation, compacted. A summary of it is below as your background context; this is a new, independent conversation.'
export const HANDOFF_MERGE_SUMMARY_OPENING =
  'This conversation continues from several other Orca conversations, merged and compacted. One summary of them is below as your background context; this is a new, independent conversation.'
// The openings `buildAgentSessionHandoffPrompt` and the merge prompt write, recognized as-is so
// chats handed off before summaries existed fold the same way.
const TRANSCRIPT_OPENING = 'This conversation continues from another Orca conversation. '
const MERGE_TRANSCRIPT_OPENING =
  /^This conversation continues from \d+ other Orca conversations, merged\./
const MERGE_PATH_NOTE =
  'The conversations may come from other workspaces, so file paths in them can differ from yours.'
const FENCE_OPEN = /^(`{3,})text$/
const SOURCE_LINE = /^(?:Source(?: \d+ of \d+)?|## Source \d+ of \d+): (.+)$/gm
const HANDED_OVER_LINE = /^Messages handed over: (\d+) of (\d+)$/m

export type HandoffSummarySource = {
  label?: string | null
  agentLabel?: string | null
  /** How the child reads the full messages when the summary is not enough. */
  reference?: string | null
}

/** The child's first message when it is handed a summary instead of the messages. */
export function buildAgentSessionSummaryHandoffPrompt(input: {
  summary: string
  sources: readonly HandoffSummarySource[]
  instruction?: string | null
}): string {
  const fence = getMarkdownFenceForTranscript(input.summary)
  const merged = input.sources.length > 1
  const sourceLines = input.sources.flatMap((source, index) => {
    const head = merged ? `Source ${index + 1} of ${input.sources.length}` : 'Source'
    return [
      ...(source.label ? [`${head}: ${source.label}`] : merged ? [head] : []),
      ...(source.agentLabel ? [`Original agent: ${source.agentLabel}`] : []),
      ...(source.reference
        ? [`Read its full messages when the summary is not enough: ${source.reference}`]
        : [])
    ]
  })
  return [
    merged ? HANDOFF_MERGE_SUMMARY_OPENING : HANDOFF_SUMMARY_OPENING,
    '',
    ...sourceLines,
    '',
    `${fence}text`,
    input.summary.trim(),
    fence,
    '',
    HANDOFF_UNTRUSTED_NOTE,
    ...(merged ? [MERGE_PATH_NOTE] : []),
    '',
    input.instruction?.trim() || HANDOFF_ACKNOWLEDGE
  ].join('\n')
}

export type ParsedHandoffMessage = {
  /** `summary`: a compacted hand-off. `messages`: the source's messages themselves. */
  kind: 'summary' | 'messages'
  merged: boolean
  /** The source chats' names, in order; empty when the hand-off did not name them. */
  sourceLabels: string[]
  /** The summary, or the handed-over messages as one text. */
  context: string
  /** Messages handed over, for a `messages` hand-off of one chat. */
  handedOver: { count: number; total: number } | null
  /** What the person asked the child to do; null when they asked nothing. */
  instruction: string | null
}

function fencedBodies(text: string): string[] {
  const bodies: string[] = []
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const fence = lines[index]!.match(FENCE_OPEN)?.[1]
    if (!fence) {
      continue
    }
    const close = lines.indexOf(fence, index + 1)
    if (close === -1) {
      break
    }
    bodies.push(lines.slice(index + 1, close).join('\n'))
    index = close
  }
  return bodies
}

/** The parts of a hand-off's first message; null for any other message. */
export function parseAgentSessionHandoffMessage(text: string): ParsedHandoffMessage | null {
  const summary = text.startsWith(HANDOFF_SUMMARY_OPENING)
  const mergedSummary = text.startsWith(HANDOFF_MERGE_SUMMARY_OPENING)
  const transcript = text.startsWith(TRANSCRIPT_OPENING)
  const mergedTranscript = MERGE_TRANSCRIPT_OPENING.test(text)
  if (!summary && !mergedSummary && !transcript && !mergedTranscript) {
    return null
  }
  // Why the last one: the carried context may quote the note itself.
  const noteAt = text.lastIndexOf(HANDOFF_UNTRUSTED_NOTE)
  if (noteAt === -1) {
    return null
  }
  const head = text.slice(0, noteAt)
  const rest = text
    .slice(noteAt + HANDOFF_UNTRUSTED_NOTE.length)
    .replace(MERGE_PATH_NOTE, '')
    .trim()
  const bodies = fencedBodies(head)
  if (bodies.length === 0) {
    return null
  }
  const sourceLabels = [...head.matchAll(SOURCE_LINE)].map((match) => match[1]!.trim())
  const counted = head.match(HANDED_OVER_LINE)
  return {
    kind: summary || mergedSummary ? 'summary' : 'messages',
    merged: mergedSummary || mergedTranscript,
    sourceLabels,
    context: bodies.join('\n\n'),
    handedOver:
      counted && !mergedTranscript
        ? { count: Number(counted[1]), total: Number(counted[2]) }
        : null,
    instruction: rest && rest !== HANDOFF_ACKNOWLEDGE ? rest : null
  }
}
