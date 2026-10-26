import { useEffect, useMemo, useState } from 'react'
import { getStructuredAgentSessionStatusFeed } from '@/runtime/native-chat/status/structured-agent-session-status-feed'
import { structuredAgentSessionTargetForHost } from '@/runtime/native-chat/session-ownership/structured-agent-session-owner'
import {
  projectMapLineageFromNames,
  type ProjectMapChat,
  type ProjectMapLineage
} from './project-map-lineage'

const NO_LINEAGE: ProjectMapLineage = new Map()

/**
 * Forks of the chats on the map, from each host's own `forkedFrom` naming. Follows the feeds while
 * mounted, so a new fork's edge appears once its host names the source.
 */
export function useProjectMapLineage(
  chats: ReadonlyMap<string, ProjectMapChat>
): ProjectMapLineage {
  const hosts = useMemo(
    () => [...new Set([...chats.values()].map((chat) => chat.executionHostId ?? ''))].sort(),
    [chats]
  )
  const hostsKey = hosts.join('|')
  const sessionIds = useMemo(() => [...chats.values()].map((chat) => chat.sessionId), [chats])
  const [lineage, setLineage] = useState(NO_LINEAGE)

  useEffect(() => {
    const feeds = hostsKey.split('|').flatMap((host) => {
      const target = structuredAgentSessionTargetForHost(host || null)
      return target ? [getStructuredAgentSessionStatusFeed(target)] : []
    })
    const read = (): void => {
      const next = projectMapLineageFromNames(
        sessionIds,
        feeds.map((feed) => feed.getNamingSnapshot())
      )
      setLineage((previous) =>
        next.size === previous.size &&
        [...next].every(([child, source]) => previous.get(child) === source)
          ? previous
          : next.size === 0
            ? NO_LINEAGE
            : next
      )
    }
    const stops = feeds.flatMap((feed) => [feed.subscribe(read), feed.activate()])
    read()
    return () => stops.forEach((stop) => stop())
  }, [hostsKey, sessionIds])

  return lineage
}
