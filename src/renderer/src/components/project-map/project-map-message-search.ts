import type {
  AiVaultSearchHit,
  AiVaultSearchResponse
} from '../../../../shared/ai-vault-search-types'
import { toAiVaultProjectKey } from '../../../../shared/ai-vault-project-key'
import type { ProjectMapGraph } from './project-map-graph'

export type ProjectMapMessageHit = {
  /** The node the matching chat is drawn as. */
  paneKey: string
  sessionId: string
  snippet: string
  role: string
}

export type ProjectMapMessageSearch = {
  hits: ProjectMapMessageHit[]
  /** Matching chats of this project that have no node on the map. */
  elsewhere: number
  /** Why some or all hosts answered nothing: search off, not indexed yet, or no service. */
  skipped: 'off' | 'not-ready' | 'unavailable' | null
}

/** The search scope a project's message search runs in: the project its workspaces belong to. */
export function projectMapSearchProjectKey(
  repoId: string,
  worktrees: readonly { projectId?: string | null; repoId: string }[]
): string | null {
  const projectId = worktrees.find((worktree) => worktree.projectId)?.projectId
  return toAiVaultProjectKey(projectId ?? null, repoId)
}

/** Message hits laid onto the map: one per chat with a node here, best match first. */
export function projectMapMessageHits(
  graph: ProjectMapGraph,
  response: AiVaultSearchResponse | null,
  hits: readonly AiVaultSearchHit[]
): ProjectMapMessageSearch {
  const paneKeyOf = new Map<string, string>()
  for (const agent of graph.agents.values()) {
    if (agent.chat) {
      paneKeyOf.set(agent.chat.sessionId, agent.card.paneKey)
    }
  }
  const found: ProjectMapMessageHit[] = []
  const seen = new Set<string>()
  let elsewhere = 0
  for (const hit of hits) {
    const sessionId = hit.structuredSession?.sessionId
    if (!sessionId || seen.has(sessionId)) {
      continue
    }
    seen.add(sessionId)
    const paneKey = paneKeyOf.get(sessionId)
    if (!paneKey) {
      elsewhere += 1
      continue
    }
    found.push({
      paneKey,
      sessionId,
      snippet: hit.evidence?.snippet ?? '',
      role: hit.evidence?.role ?? 'unknown'
    })
  }
  return { hits: found, elsewhere, skipped: skippedReason(response) }
}

function skippedReason(response: AiVaultSearchResponse | null): ProjectMapMessageSearch['skipped'] {
  if (!response) {
    return null
  }
  if (response.kind === 'unavailable') {
    return response.reason === 'disabled'
      ? 'off'
      : response.reason === 'not-ready'
        ? 'not-ready'
        : 'unavailable'
  }
  if (response.kind !== 'results') {
    return null
  }
  // Across computers, one that did not search makes the answer partial.
  const outcomes = (response.hosts ?? []).map((host) => host.outcome)
  return outcomes.includes('disabled')
    ? 'off'
    : outcomes.includes('not-ready') || outcomes.includes('stale')
      ? 'not-ready'
      : null
}
