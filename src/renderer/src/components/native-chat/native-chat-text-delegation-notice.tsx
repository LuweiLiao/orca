import { Badge } from '@/components/ui/badge'
import { getAgentCatalog } from '@/lib/agent-catalog'
import { translate } from '@/i18n/i18n'
import type { AgentDelegationUnresolved } from '../../../../shared/agent-delegation-text-resolution'
import type { NativeChatComposerNotice } from './native-chat-composer-notice'
import {
  nativeChatOrchestrationAssignment,
  nativeChatOrchestrationSeparator,
  type OrchestrationAgentSelection
} from './native-chat-orchestration-instruction'
import { useNativeChatTextDelegation } from './use-native-chat-text-delegation'

/** The row above the composer that says which agents sending this draft authorizes, if any. */
export function useNativeChatTextDelegationNotice(
  args: Parameters<typeof useNativeChatTextDelegation>[0]
): NativeChatComposerNotice | null {
  const { resolution, dismiss } = useNativeChatTextDelegation(args)
  if (resolution.kind === 'none') {
    return null
  }
  const base = { key: 'text-delegation', kind: 'delegation', onDismiss: dismiss } as const
  if (resolution.kind === 'pending') {
    return {
      ...base,
      text: translate(
        'components.native-chat.composer.textDelegation.pending',
        "Reading this host's agents and models for the agents you asked for…"
      )
    }
  }
  if (resolution.kind === 'unresolved') {
    return {
      ...base,
      text: translate(
        'components.native-chat.composer.textDelegation.unresolved',
        '{{reason}} Sending authorizes no agents; the agent can propose a card for you to send.',
        { reason: unresolvedReason(resolution.detail) }
      )
    }
  }
  const lead = translate(
    'components.native-chat.composer.textDelegation.ready',
    'Sending authorizes'
  )
  const pills = pillsOf(resolution.cards)
  return {
    ...base,
    text: `${lead} ${pills.map((pill) => pill.assignment).join(nativeChatOrchestrationSeparator())}`,
    dismissLabel: translate(
      'components.native-chat.composer.textDelegation.dismiss',
      "Don't authorize agents with this message"
    ),
    content: (
      <span className="inline-flex flex-wrap items-center gap-1">
        <span>{lead}</span>
        {pills.map((pill) => (
          <Badge
            key={pill.key}
            variant="orchestrationPill"
            data-native-chat-text-delegation={pill.agent}
            className="whitespace-normal text-left"
          >
            <span className="min-w-0 break-words [overflow-wrap:anywhere]">{pill.assignment}</span>
          </Badge>
        ))}
      </span>
    )
  }
}

/** One pill per card; a request may name the same team twice, so keys count repeats. */
function pillsOf(
  cards: readonly OrchestrationAgentSelection[]
): { key: string; agent: string; assignment: string }[] {
  const seen = new Map<string, number>()
  return cards.map((card) => {
    const assignment = nativeChatOrchestrationAssignment(card)
    const repeat = seen.get(assignment) ?? 0
    seen.set(assignment, repeat + 1)
    return { key: `${assignment}#${repeat}`, agent: card.agent, assignment }
  })
}

function unresolvedReason(detail: AgentDelegationUnresolved): string {
  const labelOf = (agent: string | null) =>
    (agent && getAgentCatalog().find((entry) => entry.id === agent)?.label) ?? agent ?? ''
  switch (detail.reason) {
    case 'agent-unavailable':
      return translate(
        'components.native-chat.composer.textDelegation.agentUnavailable',
        "{{agent}} isn't available on this chat's host.",
        { agent: labelOf(detail.agent) }
      )
    case 'model-not-found':
      return detail.agent
        ? translate(
            'components.native-chat.composer.textDelegation.modelNotFound',
            'No {{agent}} model matches "{{query}}".',
            { agent: labelOf(detail.agent), query: detail.query }
          )
        : translate(
            'components.native-chat.composer.textDelegation.modelNotFoundAnyAgent',
            'No agent on this host offers a model matching "{{query}}".',
            { query: detail.query }
          )
    case 'model-ambiguous':
      return translate(
        'components.native-chat.composer.textDelegation.modelAmbiguous',
        '"{{query}}" matches more than one model.',
        { query: detail.query }
      )
    case 'effort-needs-model':
      return translate(
        'components.native-chat.composer.textDelegation.effortNeedsModel',
        'Name a {{agent}} model to set effort {{effort}}.',
        { agent: labelOf(detail.agent), effort: detail.effort }
      )
    case 'effort-not-offered':
      return translate(
        'components.native-chat.composer.textDelegation.effortNotOffered',
        "{{model}} doesn't offer effort {{effort}} here.",
        { model: detail.model, effort: detail.effort }
      )
    case 'incomplete':
      return translate(
        'components.native-chat.composer.textDelegation.incomplete',
        "Part of this agent request couldn't be read as an exact team."
      )
  }
}
