import {
  splitOrchestrationReferences,
  type OrchestrationAgentSelection
} from './native-chat-orchestration-reference'

export const AGENT_DELEGATION_UNAUTHORIZED_CODE = 'agent_delegation_unauthorized'
export const WORKER_RETRY_PRIOR_ATTEMPT_LIVE_CODE = 'worker_retry_prior_attempt_live'
/** Client: the `orca` CLI, which is any agent's client, never a person's composer. */
export const ORCA_CLI_RUNTIME_CLIENT_CAPABILITY = 'orca-cli.client.v1' as const

/** What one agent creation asks a user's grant for; null model or effort means the default. */
export type AgentDelegationRequest = {
  agent: string
  model: string | null
  effort: string | null
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

/**
 * The assignment cards a person put in one message they submitted. Each card is a composer pill,
 * so a token here is one the person saw and sent; quoted lines and code grant nothing.
 */
export function assignmentCardsInSubmittedText(text: string): OrchestrationAgentSelection[] {
  return ownWordsLines(text).flatMap((line) =>
    splitOrchestrationReferences(line).flatMap((part) => (typeof part === 'string' ? [] : [part]))
  )
}

export function agentDelegationRequestOfCard(
  card: OrchestrationAgentSelection
): AgentDelegationRequest {
  return { agent: card.agent, model: card.model?.id ?? null, effort: card.effort ?? null }
}
