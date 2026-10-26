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

async function readHostLineage(
  target: RuntimeClientTarget,
  sessionIds: readonly string[]
): Promise<AgentSessionLineageEntry[]> {
  if (!(await hostSupportsAgentSessionFork(target))) {
    return []
  }
  try {
    const result = await callStructuredAgentSession<{ entries?: unknown }>(
      target,
      'agentSession.lineage',
      { sessionIds }
    )
    return Array.isArray(result.entries) ? result.entries.filter(isAgentSessionLineageEntry) : []
  } catch {
    // A host that cannot answer draws its chats without fork edges, as an older one does.
    return []
  }
}

/**
 * Forks recorded by every host whose chats are on the map. Re-read when the set of chats changes,
 * which is also when a new fork's chat appears, and whenever `revision` moves.
 */
export function useProjectMapLineage(
  chats: ReadonlyMap<string, ProjectMapChat>,
  revision: number
): ReadonlyMap<string, AgentSessionLineageEntry> {
  const [lineage, setLineage] = useState(NO_LINEAGE)
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
      ? key.split('|').map((part) => {
          const [host, ids] = part.split('=')
          const target = structuredAgentSessionTargetForHost(host || null)
          return target ? readHostLineage(target, ids ? ids.split(',') : []) : Promise.resolve([])
        })
      : []
    void Promise.all(reads).then((pages) => {
      if (!cancelled) {
        setLineage(
          pages.some((page) => page.length > 0) ? mergeProjectMapLineage(pages) : NO_LINEAGE
        )
      }
    })
    return () => {
      cancelled = true
    }
  }, [key, revision])

  return lineage
}
