import { useEffect, useMemo, useState } from 'react'
import { readStructuredAgentSessionConversationOutline } from '@/runtime/structured-agent-session-client'
import { structuredAgentSessionTargetForHost } from '@/runtime/structured-agent-session-owner'
import type { AgentSessionConversationOutline } from '../../../../shared/agent-session-conversation-outline'
import type { ExecutionHostId } from '../../../../shared/execution-host'

export type ProjectMapOutline =
  | { state: 'loading' | 'unsupported' | 'failed' }
  | { state: 'ready'; outline: AgentSessionConversationOutline }

/** One chat's turns from the host that owns it, read again whenever `revision` moves. */
export function useProjectMapOutline(
  chat: { sessionId: string; executionHostId: ExecutionHostId | null } | undefined,
  revision: string
): ProjectMapOutline {
  const target = useMemo(
    () => structuredAgentSessionTargetForHost(chat?.executionHostId ?? null),
    [chat?.executionHostId]
  )
  const sessionId = chat?.sessionId
  const [read, setRead] = useState<ProjectMapOutline & { of?: string }>({ state: 'loading' })
  useEffect(() => {
    if (!sessionId || !target) {
      return
    }
    let cancelled = false
    readStructuredAgentSessionConversationOutline(target, sessionId).then(
      (outline) => {
        if (!cancelled) {
          setRead(
            outline
              ? { state: 'ready', outline, of: sessionId }
              : { state: 'unsupported', of: sessionId }
          )
        }
      },
      () => {
        if (!cancelled) {
          setRead({ state: 'failed', of: sessionId })
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [sessionId, target, revision])
  // A read of another chat is stale the moment the chat changes.
  return read.of === sessionId ? read : { state: 'loading' }
}
