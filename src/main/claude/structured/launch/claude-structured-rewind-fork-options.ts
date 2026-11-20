import type { Options as ClaudeAgentSdkOptions } from '@anthropic-ai/claude-agent-sdk'
import type { AgentSessionRewindFork } from '../../../../shared/agent-session/lifecycle/rewind/agent-session-rewind'

/** Until Claude writes the rewind's session, each launch forks it from the kept conversation. */
export function claudeRewindForkOptions(
  fork: AgentSessionRewindFork
): Pick<ClaudeAgentSdkOptions, 'resume' | 'resumeSessionAt' | 'forkSession'> {
  return fork.throughEntryId
    ? { resume: fork.sourceSessionId, resumeSessionAt: fork.throughEntryId, forkSession: true }
    : {}
}
