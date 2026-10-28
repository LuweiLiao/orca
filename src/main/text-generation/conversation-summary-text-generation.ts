import {
  buildConversationSummaryPrompt,
  sanitizeGeneratedConversationSummary,
  type ConversationSummaryMessage
} from '../../shared/conversation-summary-prompt'
import type { ResolvedSourceControlAiGenerationParams } from '../../shared/source-control-ai'
import { runGenerationRequest } from './agent-generation-request'
import { spawnSourceControlAgent } from './source-control-agent-launch'
import { cancelLocalGeneration } from './source-control-generation-lanes'
import type {
  CommitMessageGenerationTarget,
  SpawnSourceControlAgent
} from './source-control-text-generation-types'

export type ConversationSummaryGeneration =
  | { success: true; text: string; agentLabel?: string }
  | { success: false; error: string; canceled?: boolean }

export async function generateConversationSummary(input: {
  messages: readonly ConversationSummaryMessage[]
  params: ResolvedSourceControlAiGenerationParams
  target: CommitMessageGenerationTarget
  spawnAgent?: SpawnSourceControlAgent
}): Promise<ConversationSummaryGeneration> {
  const result = await runGenerationRequest({
    params: input.params,
    prompt: buildConversationSummaryPrompt(input.messages, input.params.customPrompt),
    target: input.target,
    spawnAgent: input.spawnAgent ?? spawnSourceControlAgent,
    emptyResultName: 'summary',
    operation: 'conversation-summary'
  })
  if (!result.success) {
    return { success: false, error: result.error, canceled: result.canceled }
  }
  const text = sanitizeGeneratedConversationSummary(result.rawOutput)
  return text
    ? { success: true, text, agentLabel: result.agentLabel }
    : { success: false, error: 'Generated summary was empty after sanitization.' }
}

export function cancelConversationSummaryLocal(cwd: string): void {
  cancelLocalGeneration('conversation-summary', cwd)
}
