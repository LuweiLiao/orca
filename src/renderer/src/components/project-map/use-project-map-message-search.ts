import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { selectWorktreesByRepo } from '@/store/workspace-record-selectors'
import { useAiVaultPanelSearch } from '@/components/right-sidebar/use-ai-vault-search'
import { ALL_EXECUTION_HOSTS_SCOPE } from '../../../../shared/execution-host'
import { AI_VAULT_AGENTS } from '../../../../shared/ai-vault-types'
import type { ProjectMapGraph } from './project-map-graph'
import {
  projectMapMessageHits,
  projectMapSearchProjectKey,
  type ProjectMapMessageSearch
} from './project-map-message-search'

// Short queries match nearly every message; titles already cover them.
const MIN_QUERY = 2

/**
 * What the chats on the map said, from the session index of every computer, kept to this
 * project. The same search the history panel runs; nothing is indexed here.
 */
export function useProjectMapMessageSearch(
  graph: ProjectMapGraph,
  query: string
): ProjectMapMessageSearch & { searching: boolean; loading: boolean } {
  const worktrees = useAppStore((s) => selectWorktreesByRepo(s)[graph.projectId])
  const projectKey = useMemo(
    () => projectMapSearchProjectKey(graph.projectId, worktrees ?? []),
    [graph.projectId, worktrees]
  )
  const within = useMemo(
    () => (projectKey ? { kind: 'project' as const, projectKey } : undefined),
    [projectKey]
  )
  const trimmed = query.trim()
  const search = useAiVaultPanelSearch(
    trimmed.length >= MIN_QUERY ? trimmed : '',
    AI_VAULT_AGENTS,
    within,
    ALL_EXECUTION_HOSTS_SCOPE,
    'relevance'
  )
  const found = useMemo(
    () => projectMapMessageHits(graph, search.response, search.hits),
    [graph, search.response, search.hits]
  )
  return { ...found, searching: search.searching, loading: search.loading }
}
