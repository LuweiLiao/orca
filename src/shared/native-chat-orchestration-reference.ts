import { z } from 'zod'

export const ORCHESTRATION_REFERENCE_NODE = 'nativeChatOrchestration'

const selectionSchema = z.object({
  agent: z.string().min(1).max(128),
  label: z.string().min(1).max(256),
  count: z.number().int().min(1).max(99),
  task: z.string(),
  model: z.object({ id: z.string().min(1), label: z.string() }).optional(),
  effort: z.string().min(1).optional()
})

export type OrchestrationAgentSelection = z.infer<typeof selectionSchema>

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
    const parsed = selectionSchema.safeParse(JSON.parse(url.searchParams.get('data') ?? ''))
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
