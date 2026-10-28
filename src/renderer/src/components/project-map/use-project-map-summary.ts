import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConversationSummaryState } from '../../../../shared/conversation-summary'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import { createBrowserUuid } from '@/lib/browser-uuid'
import {
  cancelConversationSummary,
  generateConversationSummary,
  readConversationSummary,
  writeConversationSummary
} from '@/runtime/conversation-summary-client'
import { noteProjectMapSummary } from './project-map-summary-state'

const EMPTY: ConversationSummaryState = { summary: null, stale: false }

const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

export type ProjectMapSummaryController = {
  state: ConversationSummaryState
  loading: boolean
  generating: boolean
  error: string | null
  generate: () => void
  cancel: () => void
  save: (text: string) => Promise<boolean>
}

/** One chat's summary: read when opened, made only when the person asks, canceled on request. */
export function useProjectMapSummary(
  target: RuntimeClientTarget | null,
  sessionId: string | null
): ProjectMapSummaryController {
  const [state, setState] = useState(EMPTY)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const running = useRef<{ requestId: string; abort: AbortController } | null>(null)

  const apply = useCallback(
    (next: ConversationSummaryState) => {
      setState(next)
      if (sessionId) {
        noteProjectMapSummary(sessionId, next.summary !== null)
      }
    },
    [sessionId]
  )

  useEffect(() => {
    setState(EMPTY)
    setError(null)
    setLoading(true)
    if (!target || !sessionId) {
      setLoading(false)
      return
    }
    let cancelled = false
    readConversationSummary(target, sessionId)
      .then((next) => !cancelled && apply(next))
      .catch((failure) => !cancelled && setError(messageOf(failure)))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [apply, sessionId, target])

  const cancel = useCallback(() => {
    const current = running.current
    if (!current || !target || !sessionId) {
      return
    }
    current.abort.abort()
    void cancelConversationSummary(target, sessionId, current.requestId).catch(() => {})
  }, [sessionId, target])

  useEffect(() => cancel, [cancel])

  const generate = useCallback(() => {
    if (!target || !sessionId || running.current) {
      return
    }
    const request = { requestId: createBrowserUuid(), abort: new AbortController() }
    running.current = request
    setGenerating(true)
    setError(null)
    generateConversationSummary(target, sessionId, request.requestId, request.abort.signal)
      .then((result) => {
        if (result.success) {
          apply(result.state)
        } else if (!result.canceled) {
          setError(result.error)
        }
      })
      .catch((failure) => {
        if (!request.abort.signal.aborted) {
          setError(messageOf(failure))
        }
      })
      .finally(() => {
        running.current = null
        setGenerating(false)
      })
  }, [apply, sessionId, target])

  const save = useCallback(
    async (text: string) => {
      if (!target || !sessionId) {
        return false
      }
      try {
        apply(await writeConversationSummary(target, sessionId, text))
        setError(null)
        return true
      } catch (failure) {
        setError(messageOf(failure))
        return false
      }
    },
    [apply, sessionId, target]
  )

  return { state, loading, generating, error, generate, cancel, save }
}
