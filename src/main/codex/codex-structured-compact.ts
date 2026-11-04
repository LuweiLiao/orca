import { agentSessionFailureFact, providerDiagnosticOf } from '../../shared/agent-session-failure'
import type { StructuredAgentSessionAdapter } from '../native-chat/agent-session-wire/structured-agent-session-adapter'
import { isCodexAppServerRequestError } from './codex-app-server-connection'
import type { CodexSession } from './codex-structured-session-state'
import { codexDispatchRejection } from './codex-structured-turn-end-settlement'

/** The reply acknowledges receipt; the translator observes turn completion separately. */
export async function compactCodexThread(
  session: CodexSession,
  input: Parameters<NonNullable<StructuredAgentSessionAdapter['compact']>>[0],
  timeoutMs: number | undefined
): ReturnType<NonNullable<StructuredAgentSessionAdapter['compact']>> {
  session.translator?.beginCommand(input.command)
  try {
    await session.connection.request(
      'thread/compact/start',
      { threadId: session.threadId },
      { timeoutMs }
    )
    return { state: 'accepted', providerIdentity: null }
  } catch (error) {
    session.translator?.forgetCommand(input.command.turnId)
    if (isCodexAppServerRequestError(error)) {
      return {
        state: 'rejected',
        ...codexDispatchRejection(
          agentSessionFailureFact('providerRejected', { detail: providerDiagnosticOf(error) })
        )
      }
    }
    throw error
  }
}
