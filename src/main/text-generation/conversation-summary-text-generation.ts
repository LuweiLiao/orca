import {
  buildConversationHandoffSummaryPrompt,
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

/** The summary a hand-off child starts from, of one or several chats; never saved beside them. */
export async function generateConversationHandoffSummary(input: {
  sections: readonly { label: string | null; messages: readonly ConversationSummaryMessage[] }[]
  params: ResolvedSourceControlAiGenerationParams
  target: CommitMessageGenerationTarget
  spawnAgent?: SpawnSourceControlAgent
}): Promise<ConversationSummaryGeneration> {
  const result = await runGenerationRequest({
    params: input.params,
    prompt: buildConversationHandoffSummaryPrompt(input.sections, input.params.customPrompt),
    target: input.target,
    spawnAgent: input.spawnAgent ?? spawnSourceControlAgent,
    emptyResultName: 'summary',
    // Why its own lane: a summary the person asked for in the same workspace keeps its cancel.
    operation: 'conversation-handoff'
  })
  if (!result.success) {
    return { success: false, error: result.error, canceled: result.canceled }
  }
  const text = sanitizeGeneratedConversationSummary(result.rawOutput)
  return text
    ? { success: true, text, agentLabel: result.agentLabel }
    : { success: false, error: 'Generated summary was empty after sanitization.' }
}

export function cancelConversationHandoffSummaryLocal(cwd: string): void {
  cancelLocalGeneration('conversation-handoff', cwd)
}

export function cancelConversationSummaryLocal(cwd: string): void {
  cancelLocalGeneration('conversation-summary', cwd)
}
