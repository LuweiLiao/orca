import { useCallback, useEffect, useRef, useState } from 'react'
import { getRuntimeGitGraph } from '@/runtime/runtime-git-status-client'
import type { RuntimeGitContext } from '@/runtime/runtime-git-client-context'
import { translate } from '@/i18n/i18n'
import {
  GIT_GRAPH_DEFAULT_LIMIT,
  type GitGraphOptions,
  type GitGraphResult,
  type GitGraphScope
} from '../../../../shared/git-graph-types'
import {
  GIT_GRAPH_CURSOR_EXPIRED_CODE,
  GIT_GRAPH_CURSOR_INVALID_CODE,
  GIT_GRAPH_NOT_A_REPOSITORY_CODE,
  GIT_GRAPH_REF_NOT_FOUND_CODE,
  GIT_GRAPH_SNAPSHOT_CHANGED_CODE,
  GIT_GRAPH_UNSUPPORTED_CODE,
  getGitGraphErrorCode
} from '../../../../shared/git-graph-errors'
import { GIT_GRAPH_MAX_REFRESH_PAGES, appendGitGraphPage } from './git-graph-model'

export type GitGraphQuery = {
  /** Owner identity; a change discards every in-flight request for the previous owner. */
  ownerKey: string
  /** Re-verified owner transport for each request; throws when the owner can no longer be trusted. */
  resolveContext: () => RuntimeGitContext
  scope: GitGraphScope
  ref?: string
  /** Selected refs for scope 'refs'; order changes are treated as a new query. */
  refs?: readonly string[]
}

export type GitGraphHistoryState = {
  status: 'idle' | 'loading' | 'ready' | 'error' | 'unsupported' | 'not-git'
  result?: GitGraphResult
  error?: string
  refreshing: boolean
  loadingMore: boolean
  loadMoreError?: string
}

const IDLE_STATE: GitGraphHistoryState = { status: 'idle', refreshing: false, loadingMore: false }

function isStaleCursorError(error: unknown): boolean {
  const code = getGitGraphErrorCode(error)
  return (
    code === GIT_GRAPH_CURSOR_EXPIRED_CODE ||
    code === GIT_GRAPH_CURSOR_INVALID_CODE ||
    code === GIT_GRAPH_SNAPSHOT_CHANGED_CODE
  )
}

function errorMessage(error: unknown): string {
  if (getGitGraphErrorCode(error) === GIT_GRAPH_REF_NOT_FOUND_CODE) {
    return translate(
      'auto.components.gitGraph.history.refNotFound',
      'That branch or tag no longer exists.'
    )
  }
  if (isStaleCursorError(error)) {
    return translate(
      'auto.components.gitGraph.history.snapshotChanged',
      'The repository changed while paging. Refresh to load the latest graph.'
    )
  }
  return error instanceof Error && error.message
    ? error.message
    : translate('auto.components.gitGraph.history.loadFailed', 'Failed to load the Git graph')
}

function classifyFailure(error: unknown): Pick<GitGraphHistoryState, 'status' | 'error'> {
  const code = getGitGraphErrorCode(error)
  // Why: an older host has no git.historyGraph; say so instead of silently showing HEAD-only.
  if (code === GIT_GRAPH_UNSUPPORTED_CODE) {
    return { status: 'unsupported' }
  }
  if (code === GIT_GRAPH_NOT_A_REPOSITORY_CODE) {
    return { status: 'not-git' }
  }
  return { status: 'error', error: errorMessage(error) }
}

/**
 * Cursor-paged graph history for one owner + scope. Each query generation owns an abort signal
 * and every publish checks the generation, so a response for an earlier owner, scope or refresh
 * never lands on the current view.
 */
export function useGitGraphHistory(query: GitGraphQuery): {
  state: GitGraphHistoryState
  refresh: () => void
  loadMore: () => void
} {
  const { ownerKey, resolveContext, scope, ref, refs } = query
  // Why: an array prop is a new reference every render; derive a stable key so effects only
  // re-fire when the selected ref ids actually change, not on every parent re-render.
  const refsKey = refs ? refs.join('\u0000') : ''
  const [state, setState] = useState<GitGraphHistoryState>(IDLE_STATE)
  const generationRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const stateRef = useRef(state)
  const resolveContextRef = useRef(resolveContext)
  useEffect(() => {
    resolveContextRef.current = resolveContext
  }, [resolveContext])

  const publish = useCallback(
    (generation: number, update: (previous: GitGraphHistoryState) => GitGraphHistoryState) => {
      if (generationRef.current !== generation) {
        return
      }
      // Why: computed eagerly so stateRef is current before the next user action reads it.
      const next = update(stateRef.current)
      stateRef.current = next
      setState(next)
    },
    []
  )

  const startGeneration = useCallback((): { generation: number; signal: AbortSignal } => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    generationRef.current += 1
    return { generation: generationRef.current, signal: controller.signal }
  }, [])

  const baseOptions = useCallback(
    (): GitGraphOptions => ({
      scope,
      ...(scope === 'ref' ? { ref } : {}),
      // Why: split from refsKey (not the refs prop) so this stays stable across re-renders.
      ...(scope === 'refs' ? { refs: refsKey ? refsKey.split('\u0000') : [] } : {}),
      limit: GIT_GRAPH_DEFAULT_LIMIT
    }),
    [ref, refsKey, scope]
  )

  const load = useCallback(
    async (mode: 'initial' | 'refresh'): Promise<void> => {
      const { generation, signal } = startGeneration()
      if (scope === 'ref' && !ref) {
        publish(generation, () => IDLE_STATE)
        return
      }
      if (scope === 'refs' && !refsKey) {
        publish(generation, () => IDLE_STATE)
        return
      }
      const previousCount = mode === 'refresh' ? (stateRef.current.result?.items.length ?? 0) : 0
      publish(generation, (previous) =>
        mode === 'refresh' && previous.result
          ? { ...previous, refreshing: true, loadingMore: false, loadMoreError: undefined }
          : { status: 'loading', refreshing: false, loadingMore: false }
      )
      try {
        const context = resolveContextRef.current()
        const options = baseOptions()
        let result = await getRuntimeGitGraph(context, options, { signal })
        // Why: replay already-loaded depth from a fresh snapshot so a refresh keeps selection and scroll.
        for (
          let page = 1;
          page < GIT_GRAPH_MAX_REFRESH_PAGES &&
          result.items.length < previousCount &&
          result.hasMore &&
          result.nextCursor &&
          generationRef.current === generation;
          page += 1
        ) {
          const next = await getRuntimeGitGraph(
            context,
            { ...options, cursor: result.nextCursor },
            { signal }
          )
          result = appendGitGraphPage(result, next)
        }
        const loaded = result
        publish(generation, () => ({
          status: 'ready',
          result: loaded,
          refreshing: false,
          loadingMore: false
        }))
      } catch (error) {
        publish(generation, (previous) => {
          const failure = classifyFailure(error)
          // Why: a failed refresh keeps the rows already on screen and reports inline.
          if (mode === 'refresh' && previous.result && failure.status === 'error') {
            return { ...previous, refreshing: false, error: failure.error }
          }
          return { ...failure, refreshing: false, loadingMore: false }
        })
      }
    },
    [baseOptions, publish, ref, refsKey, scope, startGeneration]
  )

  useEffect(() => {
    void load('initial')
    // Why: ownerKey stands in for the context, which is re-resolved per request.
  }, [load, ownerKey])

  useEffect(
    () => () => {
      // Why: an unmounted tab must not publish late responses or keep host walks alive.
      generationRef.current += 1
      abortRef.current?.abort()
    },
    []
  )

  const refresh = useCallback(() => {
    void load(stateRef.current.result ? 'refresh' : 'initial')
  }, [load])

  const loadMore = useCallback(() => {
    const current = stateRef.current
    const cursor = current.result?.nextCursor
    if (!current.result?.hasMore || !cursor || current.loadingMore || current.refreshing) {
      return
    }
    const generation = generationRef.current
    const signal = abortRef.current?.signal
    let context: RuntimeGitContext
    try {
      context = resolveContextRef.current()
    } catch (error) {
      publish(generation, (previous) => ({ ...previous, loadMoreError: errorMessage(error) }))
      return
    }
    publish(generation, (previous) => ({
      ...previous,
      loadingMore: true,
      loadMoreError: undefined
    }))
    getRuntimeGitGraph(context, { ...baseOptions(), cursor }, { signal }).then(
      (page) =>
        publish(generation, (previous) =>
          // Why: only extend the snapshot this cursor came from.
          previous.result?.nextCursor === cursor
            ? { ...previous, result: appendGitGraphPage(previous.result, page), loadingMore: false }
            : { ...previous, loadingMore: false }
        ),
      (error: unknown) => {
        if (generationRef.current !== generation) {
          return
        }
        // Why: an expired snapshot cannot continue; restart from page one at the same depth.
        if (isStaleCursorError(error)) {
          void load('refresh')
          return
        }
        publish(generation, (previous) => ({
          ...previous,
          loadingMore: false,
          loadMoreError: errorMessage(error)
        }))
      }
    )
  }, [baseOptions, load, publish])

  return { state, refresh, loadMore }
}
