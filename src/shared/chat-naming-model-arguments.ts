import { tokenizeCustomCommandTemplate } from './commit-message-prompt'
import { findOptionOccurrence } from './command-option-occurrence'

const MODEL_OPTIONS = ['--model', '-m']

export function chatNamingModelArgument(args: string): string | undefined {
  const parsed = tokenizeCustomCommandTemplate(args, 'literal')
  return parsed.ok ? findOptionOccurrence(parsed.tokens, MODEL_OPTIONS, true)?.value : undefined
}

export function replaceChatNamingModelArgument(args: string, model: string): string {
  let remaining = args
  for (;;) {
    const parsed = tokenizeCustomCommandTemplate(remaining, 'literal')
    if (!parsed.ok) {
      throw new Error(parsed.error)
    }
    const found = findOptionOccurrence(parsed.tokens, MODEL_OPTIONS, true)
    if (!found) {
      break
    }
    const start = parsed.spans[found.index].start
    const end = parsed.spans[found.index + found.consumed - 1].end
    remaining = `${remaining.slice(0, start)}${remaining.slice(end)}`.trim()
  }
  // Model IDs come from a catalog, but quote them for the existing argv parser.
  const quoted = `'${model.replaceAll("'", "'\"'\"'")}'`
  return `--model ${quoted}${remaining ? ` ${remaining}` : ''}`
}
