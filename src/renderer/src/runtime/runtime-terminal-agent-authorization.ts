import type { OrchestrationAgentSelection } from '../../../shared/native-chat-orchestration-reference'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { callRuntimeRpc } from './runtime-rpc-client'
import { getRemoteRuntimePtyOwner } from './runtime-terminal-stream'

/**
 * A terminal agent reads its messages as raw input, so its host cannot tell a person's card from
 * any other text. The composer records the pills it is sending as the person's own action, then
 * reports whether the message reached the terminal: only then do they authorize the agent.
 * Hosts that predate the methods neither accept nor require them.
 */
export function authorizeTerminalAgentCards(
  ptyId: string,
  cards: readonly OrchestrationAgentSelection[]
): ((delivered: boolean) => void) | null {
  if (cards.length === 0) {
    return null
  }
  const owner = getRemoteRuntimePtyOwner(ptyId)
  const target = owner ? owner.target : ({ kind: 'local' } as const)
  const submission = {
    ...(owner ? { terminal: owner.terminal } : { ptyId }),
    submissionId: createBrowserUuid()
  }
  const recorded = callRuntimeRpc(
    target,
    'agentDelegation.authorizeTerminal',
    { ...submission, cards },
    { timeoutMs: 15_000 }
  ).then(
    () => true,
    (error: unknown) => {
      // The agent's own refusal tells the person the cards did not authorize it.
      console.warn('[native-chat] terminal agent cards were not recorded', error)
      return false
    }
  )
  return (delivered) => {
    void recorded.then((ok) =>
      ok
        ? callRuntimeRpc(
            target,
            'agentDelegation.settleTerminal',
            { ...submission, delivered },
            { timeoutMs: 15_000 }
          ).catch((error: unknown) => {
            console.warn('[native-chat] terminal agent cards were not settled', error)
          })
        : undefined
    )
  }
}
