import { useCallback, useEffect, useRef, useState } from 'react'
import { translate } from '@/i18n/i18n'
import type { GitHistoryItem } from '../../../../shared/git-history-types'
import type { GitBranchChangeEntry } from '../../../../shared/git-diff-compare-types'
import type { GitHistoryCommitFilesState } from '../right-sidebar/source-control/sync/git-history-commit-files'

const MAX_CACHED_COMMIT_FILES = 40

type CommitFilesLoader = (item: GitHistoryItem) => Promise<GitBranchChangeEntry[]>

type CommitFilesCache = {
  loader: CommitFilesLoader
  entries: ReadonlyMap<string, GitHistoryCommitFilesState>
}

function withEntry(
  cache: CommitFilesCache,
  id: string,
  state: GitHistoryCommitFilesState
): CommitFilesCache {
  const entries = new Map(cache.entries)
  entries.delete(id)
  entries.set(id, state)
  for (const oldest of entries.keys()) {
    if (entries.size <= MAX_CACHED_COMMIT_FILES) {
      break
    }
    entries.delete(oldest)
  }
  return { loader: cache.loader, entries }
}

/**
 * File lists for the selected commit, kept in a small LRU so stepping back through recent
 * commits is instant without letting a long browsing session grow without bound.
 */
export function useGitGraphCommitFiles(
  item: GitHistoryItem | null,
  loadCommitFiles: CommitFilesLoader
): { state: GitHistoryCommitFilesState | null; retry: () => void } {
  const [cache, setCache] = useState<CommitFilesCache>(() => ({
    loader: loadCommitFiles,
    entries: new Map()
  }))
  const inFlightRef = useRef<{ loader: CommitFilesLoader; ids: Set<string> }>({
    loader: loadCommitFiles,
    ids: new Set()
  })
  // Why: a new loader means a new owner; its files must not mix with the previous host's.
  const currentCache =
    cache.loader === loadCommitFiles ? cache : { loader: loadCommitFiles, entries: new Map() }
  if (currentCache !== cache) {
    setCache(currentCache)
  }

  const request = useCallback(
    (target: GitHistoryItem) => {
      if (inFlightRef.current.loader !== loadCommitFiles) {
        inFlightRef.current = { loader: loadCommitFiles, ids: new Set() }
      }
      const inFlight = inFlightRef.current.ids
      if (inFlight.has(target.id)) {
        return
      }
      const id = target.id
      const publish = (state: GitHistoryCommitFilesState): void =>
        setCache((previous) =>
          previous.loader === loadCommitFiles ? withEntry(previous, id, state) : previous
        )
      inFlight.add(id)
      publish({ status: 'loading' })
      loadCommitFiles(target).then(
        (entries) => {
          inFlight.delete(id)
          publish({ status: 'ready', entries })
        },
        (error: unknown) => {
          inFlight.delete(id)
          publish({
            status: 'error',
            error:
              error instanceof Error && error.message
                ? error.message
                : translate(
                    'auto.components.right.sidebar.SourceControl.8a5ba6a988',
                    'Failed to load commit diff'
                  )
          })
        }
      )
    },
    [loadCommitFiles]
  )

  const hasEntry = item ? currentCache.entries.has(item.id) : true
  useEffect(() => {
    if (item && !hasEntry) {
      request(item)
    }
  }, [hasEntry, item, request])

  const retry = useCallback(() => {
    if (item) {
      inFlightRef.current.ids.delete(item.id)
      request(item)
    }
  }, [item, request])

  return { state: item ? (currentCache.entries.get(item.id) ?? null) : null, retry }
}
