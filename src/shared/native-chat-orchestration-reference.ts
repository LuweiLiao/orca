import { z } from 'zod'

export const ORCHESTRATION_REFERENCE_NODE = 'nativeChatOrchestration'

export const OrchestrationAgentSelectionSchema = z.object({
  agent: z.string().min(1).max(128),
  label: z.string().min(1).max(256),
  count: z.number().int().min(1).max(99),
  task: z.string(),
  model: z.object({ id: z.string().min(1), label: z.string() }).optional(),
  effort: z.string().min(1).optional()
})

export type OrchestrationAgentSelection = z.infer<typeof OrchestrationAgentSelectionSchema>

export function orchestrationReferenceToken(
  selection: OrchestrationAgentSelection,
  label: string
): string {
  const title = label.replace(/[\r\n]+/g, ' ').replace(/[\\[\]`*_<>]/g, '\\$&')
  const data = encodeURIComponent(JSON.stringify(selection)).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  )
  return `[${title}](orca-orchestration://assignment/v1?data=${data})`
}

export function parseOrchestrationReferenceUri(value: string): OrchestrationAgentSelection | null {
  if (!value.startsWith('orca-orchestration://assignment/v1?')) {
    return null
  }
  try {
    const url = new URL(value)
    if (
      url.hostname !== 'assignment' ||
      url.pathname !== '/v1' ||
      url.username ||
      url.password ||
      url.port ||
      url.hash
    ) {
      return null
    }
    const parsed = OrchestrationAgentSelectionSchema.safeParse(
      JSON.parse(url.searchParams.get('data') ?? '')
    )
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function splitOrchestrationReferences(
  text: string
): (string | OrchestrationAgentSelection)[] {
  const pattern =
    /\[((?:\\.|[^\]\\\n])*)\]\((orca-orchestration:\/\/assignment\/v1\?data=[^\s)]*)\)/g
  const parts: (string | OrchestrationAgentSelection)[] = []
  let offset = 0
  for (const match of text.matchAll(pattern)) {
    const selection = parseOrchestrationReferenceUri(match[2]!)
    if (!selection) {
      continue
    }
    if (match.index > offset) {
      parts.push(text.slice(offset, match.index))
    }
    parts.push(selection)
    offset = match.index + match[0].length
  }
  if (offset < text.length) {
    parts.push(text.slice(offset))
  }
  return parts
}

const FENCE = /^(`{3,}|~{3,})/
const INLINE_CODE = /`+[^`]*`+/g

/**
 * The lines of a message in the sender's own words. Quoted lines and code are text being shown,
 * such as an agent's reply pasted back.
 */
export function ownWordsLines(text: string): string[] {
  const lines: string[] = []
  let fence: string | null = null
  for (const line of text.split('\n')) {
    const trimmed = line.trimStart()
    const marker = trimmed.match(FENCE)?.[1]
    if (marker) {
      if (fence === null) {
        fence = marker[0]!
      } else if (marker[0] === fence) {
        fence = null
      }
      continue
    }
    if (fence === null && !trimmed.startsWith('>')) {
      lines.push(line.replace(INLINE_CODE, ''))
    }
  }
  return lines
}

/** The assignment cards in one message's own words; quoted lines and code hold none. */
export function assignmentCardsInSubmittedText(text: string): OrchestrationAgentSelection[] {
  return ownWordsLines(text).flatMap((line) =>
    splitOrchestrationReferences(line).flatMap((part) => (typeof part === 'string' ? [] : [part]))
  )
}
