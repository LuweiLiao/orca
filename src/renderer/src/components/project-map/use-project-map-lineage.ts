import { useEffect, useMemo, useState } from 'react'
import { getStructuredAgentSessionStatusFeed } from '@/runtime/native-chat/status/structured-agent-session-status-feed'
import { structuredAgentSessionTargetForHost } from '@/runtime/native-chat/session-ownership/structured-agent-session-owner'
import { normalizeExecutionHostId } from '../../../../shared/execution-host/execution-host'
import {
  projectMapLineageFromFeeds,
  type ProjectMapChat,
  type ProjectMapHistoryChat,
  type ProjectMapLineage
} from './project-map-lineage'

type MapLineage = {
  lineage: ProjectMapLineage
  history: ReadonlyMap<string, ProjectMapHistoryChat>
}

const NONE: MapLineage = { lineage: new Map(), history: new Map() }

function sameLineage(a: MapLineage, b: MapLineage): boolean {
  return (
    a.lineage.size === b.lineage.size &&
    [...a.lineage].every(([child, source]) => b.lineage.get(child) === source) &&
    a.history.size === b.history.size &&
    [...a.history].every(([id, chat]) => {
      const other = b.history.get(id)
      return (
        other?.title === chat.title &&
        other.workspaceId === chat.workspaceId &&
        other.agent === chat.agent
      )
    })
  )
}

/**
 * Forks of the chats on the map, from each host's own `forkedFrom` naming, and the closed chats a
 * fork still runs through. Follows the feeds while mounted, so a new fork's edge appears once its
 * host names the source.
 */
export function useProjectMapLineage(chats: ReadonlyMap<string, ProjectMapChat>): MapLineage {
  const hostsKey = useMemo(
    () =>
      [...new Set([...chats.values()].map((chat) => chat.executionHostId ?? ''))].sort().join('|'),
    [chats]
  )
  const sessionIds = useMemo(() => [...chats.values()].map((chat) => chat.sessionId), [chats])
  const [state, setState] = useState(NONE)

  useEffect(() => {
    const feeds = hostsKey.split('|').flatMap((host) => {
      const target = structuredAgentSessionTargetForHost(host || null)
      return target
        ? [
            {
              executionHostId: host ? normalizeExecutionHostId(host) : null,
              feed: getStructuredAgentSessionStatusFeed(target)
            }
          ]
        : []
    })
    const read = (): void => {
      const next = projectMapLineageFromFeeds(
        sessionIds,
        feeds.map(({ executionHostId, feed }) => ({
          executionHostId,
          names: feed.getNamingSnapshot(),
          statuses: feed.getSnapshot()
        }))
      )
      setState((previous) =>
        sameLineage(previous, next)
          ? previous
          : next.lineage.size === 0 && next.history.size === 0
            ? NONE
            : next
      )
    }
    const stops = feeds.flatMap(({ feed }) => [feed.subscribe(read), feed.activate()])
    read()
    return () => stops.forEach((stop) => stop())
  }, [hostsKey, sessionIds])

  return state
}
