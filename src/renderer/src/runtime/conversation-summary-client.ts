import {
  CONVERSATION_SUMMARY_CAPABILITY,
  type ConversationSummaryGenerateResult,
  type ConversationSummaryState
} from '../../../shared/conversation-summary'
import type { RuntimeClientTarget } from '../../../shared/runtime-client-target'
import {
  ensureLocalRuntimeCapabilities,
  readLocalRuntimeCapabilitiesOrUnknown
} from './local-runtime-capabilities'
import { callRuntimeRpc, runtimeEnvironmentSupportsCapability } from './runtime-rpc-client'

// A billed model call that may read a long chat; the host bounds the run itself.
const GENERATE_TIMEOUT_MS = 6 * 60_000

/** An unknown probe reads as an older host: a summary call is never sent before the host proves it. */
export async function hostSupportsConversationSummary(
  target: RuntimeClientTarget
): Promise<boolean> {
  try {
    if (target.kind === 'local') {
      const capabilities =
        readLocalRuntimeCapabilitiesOrUnknown() ?? (await ensureLocalRuntimeCapabilities())
      return capabilities?.includes(CONVERSATION_SUMMARY_CAPABILITY) === true
    }
    return await runtimeEnvironmentSupportsCapability(
      target.environmentId,
      CONVERSATION_SUMMARY_CAPABILITY
    )
  } catch {
    return false
  }
}

export function listConversationSummaries(
  target: RuntimeClientTarget,
  sessionIds: readonly string[]
): Promise<{ sessionIds: string[] }> {
  return callRuntimeRpc(target, 'agentSession.summaryList', { sessionIds })
}

export function readConversationSummary(
  target: RuntimeClientTarget,
  sessionId: string
): Promise<ConversationSummaryState> {
  return callRuntimeRpc(target, 'agentSession.summaryRead', { sessionId })
}

export function writeConversationSummary(
  target: RuntimeClientTarget,
  sessionId: string,
  text: string
): Promise<ConversationSummaryState> {
  return callRuntimeRpc(target, 'agentSession.summaryWrite', { sessionId, text })
}

export function generateConversationSummary(
  target: RuntimeClientTarget,
  sessionId: string,
  requestId: string,
  signal?: AbortSignal
): Promise<ConversationSummaryGenerateResult> {
  return callRuntimeRpc(
    target,
    'agentSession.summaryGenerate',
    { sessionId, requestId },
    { timeoutMs: GENERATE_TIMEOUT_MS, ...(signal ? { signal } : {}) }
  )
}

export async function cancelConversationSummary(
  target: RuntimeClientTarget,
  sessionId: string,
  requestId: string
): Promise<void> {
  await callRuntimeRpc(target, 'agentSession.summaryCancel', { sessionId, requestId })
}
