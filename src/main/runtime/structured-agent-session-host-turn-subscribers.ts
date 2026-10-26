import type { AgentSessionTurnCompletion } from '../../shared/agent-session-turn-completion-wire'
import type { StructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-host'
import type { StructuredAttentionMobileDelivery } from './structured-agent-session-mobile-attention'

/** Host-side listeners on settled turns and raised prompts. They live exactly as long as the host:
 *  teardown drops the host and its subscribers together. */
export function subscribeStructuredHostTurnListeners(
  host: StructuredAgentSessionHost,
  deps: {
    attentionDelivery?: StructuredAttentionMobileDelivery
    onTurnCompletion?: (completion: AgentSessionTurnCompletion) => void
  }
): void {
  const delivery = deps.attentionDelivery
  if (delivery) {
    host.subscribeTurnCompletions({
      id: 'host-attention-delivery',
      includePrompts: true,
      emit: (event) => {
        if (event.type === 'end') {
          return
        }
        const sessionId =
          event.type === 'prompt' ? event.prompt.sessionId : event.completion.sessionId
        delivery.deliver(event, host.readStatusSummary(sessionId))
      },
      onState: delivery.reconcile
    })
  }
  const onTurnCompletion = deps.onTurnCompletion
  if (onTurnCompletion) {
    host.subscribeTurnCompletions({
      id: 'host-turn-completion',
      emit: (event) => {
        if (event.type === 'completion') {
          onTurnCompletion(event.completion)
        }
      }
    })
  }
}
