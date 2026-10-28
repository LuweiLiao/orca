import { useEffect, useMemo } from 'react'
import {
  hostSupportsConversationSummary,
  listConversationSummaries
} from '@/runtime/conversation-summary-client'
import { structuredAgentSessionTargetForHost } from '@/runtime/structured-agent-session-owner'
import type { ProjectMapGraph } from './project-map-graph'
import { projectMapAgentForkable } from './project-map-window-subject'
import { setProjectMapSummaryIndex } from './project-map-summary-state'

/** Reads, per host, which chats on the map have a summary; a host without the capability is noted. */
export function useProjectMapSummaryIndex(graph: ProjectMapGraph | null): void {
  const key = useMemo(() => {
    const byHost = new Map<string, string[]>()
    for (const agent of graph?.agents.values() ?? []) {
      if (agent.chat && projectMapAgentForkable(agent)) {
        const host = agent.chat.executionHostId ?? ''
        byHost.set(host, [...(byHost.get(host) ?? []), agent.chat.sessionId])
      }
    }
    return [...byHost.entries()]
      .map(([host, ids]) => `${host}=${[...new Set(ids)].sort().join(',')}`)
      .sort()
      .join('|')
  }, [graph])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const summarized = new Set<string>()
      const unsupported = new Set<string>()
      await Promise.all(
        (key ? key.split('|') : []).map(async (part) => {
          const [host = '', ids = ''] = part.split('=')
          const target = structuredAgentSessionTargetForHost(host || null)
          if (!target) {
            return
          }
          if (!(await hostSupportsConversationSummary(target))) {
            unsupported.add(host)
            return
          }
          const found = await listConversationSummaries(target, ids.split(',')).catch(() => null)
          found?.sessionIds.forEach((sessionId) => summarized.add(sessionId))
        })
      )
      if (!cancelled) {
        setProjectMapSummaryIndex(summarized, unsupported)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [key])
}
