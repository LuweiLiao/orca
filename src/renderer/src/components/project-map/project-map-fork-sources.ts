import {
  agentSessionForkFingerprint,
  type AgentSessionForkParams
} from '../../../../shared/agent-session-fork'
import { createStructuredAgentSessionId } from '../../../../shared/structured-agent-session-create'
import { createStructuredAgentSessionOperationId } from '../../../../shared/structured-agent-session-mutation'
import { toRuntimeWorktreeSelector } from '@/runtime/runtime-worktree-selector'
import type { ProjectMapAgent } from './project-map-graph'

export type ProjectMapForkSource = {
  agent: ProjectMapAgent
  /** 0 is the clicked node, 1 its parent, 2 its grandparent... */
  depth: number
  cut: AgentSessionForkParams['cut']
}

/**
 * The clicked chat and each ancestor whose conversation can seed a child on the same host. An
 * ancestor is cut where it once forked the next node down, so "go back to the grandparent" means
 * the grandparent as it was then, not what it said afterwards.
 */
export function projectMapForkSources(
  clicked: ProjectMapAgent,
  agents: ReadonlyMap<string, ProjectMapAgent>
): ProjectMapForkSource[] {
  const host = clicked.chat?.executionHostId ?? null
  const sources: ProjectMapForkSource[] = []
  const seen = new Set<string>()
  let below: ProjectMapAgent | null = null
  let cursor: ProjectMapAgent | undefined = clicked
  let depth = 0
  while (cursor && !seen.has(cursor.card.paneKey)) {
    seen.add(cursor.card.paneKey)
    if (cursor.chat && cursor.chat.executionHostId === host) {
      const forkedFromHere: ProjectMapAgent | null =
        below?.fork && below.fork.entry.sourceSessionId === cursor.chat.sessionId ? below : null
      sources.push({
        agent: cursor,
        depth,
        cut: forkedFromHere?.chat
          ? { kind: 'fork-point', childSessionId: forkedFromHere.chat.sessionId }
          : { kind: 'latest' }
      })
    }
    below = cursor
    cursor = cursor.parentPaneKey ? agents.get(cursor.parentPaneKey) : undefined
    depth += 1
  }
  return sources
}

/** A fork request with the envelope both sides fingerprint the same way. */
export function projectMapForkRequest(input: {
  source: ProjectMapForkSource
  origin: ProjectMapAgent
  agent: string
  model?: string
  effort?: string
  instruction: string
  randomUuid: () => string
}): AgentSessionForkParams | null {
  const sourceChat = input.source.agent.chat
  const originChat = input.origin.chat
  if (!sourceChat || !originChat) {
    return null
  }
  const options = {
    ...(input.model ? { model: input.model } : {}),
    ...(input.model && input.effort ? { effort: input.effort } : {})
  }
  const instruction = input.instruction.trim()
  const intent = {
    sourceSessionId: sourceChat.sessionId,
    originSessionId: originChat.sessionId,
    cut: input.source.cut,
    // The child joins the clicked node's workspace, whichever ancestor it inherits from.
    worktree: toRuntimeWorktreeSelector(input.origin.card.worktreeId),
    agent: input.agent,
    ...(Object.keys(options).length > 0 ? { options } : {}),
    ...(instruction ? { instruction } : {})
  }
  const sessionId = createStructuredAgentSessionId(input.agent, input.randomUuid)
  return {
    envelope: {
      sessionId,
      clientOperationId: createStructuredAgentSessionOperationId(input.randomUuid),
      expectedRuntimeFence: null,
      payloadFingerprint: agentSessionForkFingerprint({ ...intent, envelope: { sessionId } })
    },
    ...intent
  }
}
