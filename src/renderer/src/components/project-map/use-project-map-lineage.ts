import { useEffect, useState } from 'react'
import {
  AGENT_SESSION_FORK_RUNTIME_CAPABILITY,
  isAgentSessionLineageEntry,
  type AgentSessionLineageEntry
} from '../../../../shared/agent-session-fork'
import { callStructuredAgentSession } from '@/runtime/structured-agent-session-client'
import { structuredAgentSessionTargetForHost } from '@/runtime/structured-agent-session-owner'
import { runtimeEnvironmentSupportsCapability } from '@/runtime/runtime-rpc-client'
import {
  ensureLocalRuntimeCapabilities,
  readLocalRuntimeCapabilitiesOrUnknown
} from '@/runtime/local-runtime-capabilities'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import { mergeProjectMapLineage, type ProjectMapChat } from './project-map-lineage'

const NO_LINEAGE: ReadonlyMap<string, AgentSessionLineageEntry> = new Map()

/** Whether this chat's host records forks; an older host answers neither fork nor lineage. */
export async function hostSupportsAgentSessionFork(target: RuntimeClientTarget): Promise<boolean> {
  try {
    if (target.kind === 'local') {
      const capabilities =
        readLocalRuntimeCapabilitiesOrUnknown() ?? (await ensureLocalRuntimeCapabilities())
      return capabilities?.includes(AGENT_SESSION_FORK_RUNTIME_CAPABILITY) === true
    }
    return await runtimeEnvironmentSupportsCapability(
      target.environmentId,
      AGENT_SESSION_FORK_RUNTIME_CAPABILITY
    )
  } catch {
    return false
  }
}

// Under `LineageParams`' cap, so a project with more chats is read in pages instead of refused.
const LINEAGE_PAGE = 1024

type HostLineage = { supported: boolean; entries: AgentSessionLineageEntry[] }

async function readHostLineage(
  target: RuntimeClientTarget,
  sessionIds: readonly string[]
): Promise<HostLineage> {
  if (!(await hostSupportsAgentSessionFork(target))) {
    return { supported: false, entries: [] }
  }
  const pages: string[][] = []
  for (let start = 0; start < sessionIds.length; start += LINEAGE_PAGE) {
    pages.push(sessionIds.slice(start, start + LINEAGE_PAGE))
  }
  const entries = await Promise.all(
    pages.map(async (page) => {
      try {
        const result = await callStructuredAgentSession<{ entries?: unknown }>(
          target,
          'agentSession.lineage',
          { sessionIds: page }
        )
        return Array.isArray(result.entries)
          ? result.entries.filter(isAgentSessionLineageEntry)
          : []
      } catch {
        // A host that cannot answer draws its chats without fork edges, as an older one does.
        return []
      }
    })
  )
  return { supported: true, entries: entries.flat() }
}

export type ProjectMapLineage = {
  entries: ReadonlyMap<string, AgentSessionLineageEntry>
  /** Hosts known to predate forks: their chats show the fork action disabled, with the reason. */
  forkUnsupportedHosts: ReadonlySet<string>
}

const NO_HOSTS: ReadonlySet<string> = new Set()
const EMPTY_LINEAGE: ProjectMapLineage = { entries: NO_LINEAGE, forkUnsupportedHosts: NO_HOSTS }

/**
 * Forks recorded by every host whose chats are on the map. Re-read when the set of chats changes,
 * which is also when a new fork's chat appears, and whenever `revision` moves.
 */
export function useProjectMapLineage(
  chats: ReadonlyMap<string, ProjectMapChat>,
  revision: number
): ProjectMapLineage {
  const [lineage, setLineage] = useState(EMPTY_LINEAGE)
  const sessionsByHost = new Map<string, string[]>()
  for (const chat of chats.values()) {
    const host = chat.executionHostId ?? ''
    sessionsByHost.set(host, [...(sessionsByHost.get(host) ?? []), chat.sessionId])
  }
  const key = [...sessionsByHost.entries()]
    .map(([host, ids]) => `${host}=${[...ids].sort().join(',')}`)
    .sort()
    .join('|')

  useEffect(() => {
    let cancelled = false
    const reads = key
      ? key.split('|').map(async (part) => {
          const [host = '', ids] = part.split('=')
          const target = structuredAgentSessionTargetForHost(host || null)
          const read = target
            ? await readHostLineage(target, ids ? ids.split(',') : [])
            : { supported: true, entries: [] }
          return { host, ...read }
        })
      : []
    void Promise.all(reads).then((hosts) => {
      if (cancelled) {
        return
      }
      const unsupported = hosts.filter((host) => !host.supported).map((host) => host.host)
      const pages = hosts.map((host) => host.entries)
      setLineage({
        entries: pages.some((page) => page.length > 0) ? mergeProjectMapLineage(pages) : NO_LINEAGE,
        forkUnsupportedHosts: unsupported.length > 0 ? new Set(unsupported) : NO_HOSTS
      })
    })
    return () => {
      cancelled = true
    }
  }, [key, revision])

  return lineage
}
