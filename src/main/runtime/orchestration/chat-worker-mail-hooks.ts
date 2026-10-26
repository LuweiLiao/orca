import {
  escalateChatWorkerError,
  type ChatWorkerErrorEscalationDeps
} from './chat-worker-error-escalation'
import { escalateChatWorkerUnreportedTurn } from './chat-worker-unreported-turn-escalation'
import type { StructuredAgentSessionRuntimeDeps } from '../structured-agent-session-runtime'

/** The structured host's hooks through which a chat worker's failed or unreported turn mails its Run. */
export function chatWorkerMailHooks(
  deps: ChatWorkerErrorEscalationDeps
): Pick<StructuredAgentSessionRuntimeDeps, 'onRequestFailure' | 'onTurnCompletion'> {
  return {
    onRequestFailure: (failure) => void escalateChatWorkerError(failure, deps),
    onTurnCompletion: (completion) => escalateChatWorkerUnreportedTurn(completion, deps)
  }
}
