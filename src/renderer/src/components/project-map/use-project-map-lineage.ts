import { useEffect, useState } from 'react'
import {
  AGENT_SESSION_FORK_MERGE_RUNTIME_CAPABILITY,
  AGENT_SESSION_FORK_RUNTIME_CAPABILITY,
  isAgentSessionLineageEntry,
  isAgentSessionLineageSession,
  withoutHandoffReferences,
  type AgentSessionLineageEntry,
  type AgentSessionLineageSession
} from '../../../../shared/agent-session-fork'
import { callStructuredAgentSession } from '@/runtime/structured-agent-session-client'
import { structuredAgentSessionTargetForHost } from '@/runtime/structured-agent-session-owner'
import { runtimeEnvironmentSupportsCapability } from '@/runtime/runtime-rpc-client'
import {
  ensureLocalRuntimeCapabilities,
  readLocalRuntimeCapabilitiesOrUnknown
} from '@/runtime/local-runtime-capabilities'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import {
  AGENT_SESSION_REFERENCES_RUNTIME_CAPABILITY,
  isAgentSessionReferenceLink,
  type AgentSessionReferenceLink
} from '../../../../shared/agent-session-reference-link'
import { normalizeExecutionHostId } from '../../../../shared/execution-host'
import {
  mergeProjectMapLineage,
  type ProjectMapChat,
  type ProjectMapHistoryChat
} from './project-map-lineage'

const NO_LINEAGE: ReadonlyMap<string, AgentSessionLineageEntry> = new Map()

async function hostSupports(target: RuntimeClientTarget, capability: string): Promise<boolean> {
  try {
    if (target.kind === 'local') {
      const capabilities =
        readLocalRuntimeCapabilitiesOrUnknown() ?? (await ensureLocalRuntimeCapabilities())
      return capabilities?.includes(capability) === true
    }
    return await runtimeEnvironmentSupportsCapability(target.environmentId, capability)
  } catch {
    return false
  }
}

/** Whether this chat's host forks at a picked message and merges several chats into one. */
export function hostSupportsAgentSessionForkMerge(target: RuntimeClientTarget): Promise<boolean> {
  return hostSupports(target, AGENT_SESSION_FORK_MERGE_RUNTIME_CAPABILITY)
}

/** Whether this chat's host records forks; an older host answers neither fork nor lineage. */
export function hostSupportsAgentSessionFork(target: RuntimeClientTarget): Promise<boolean> {
  return hostSupports(target, AGENT_SESSION_FORK_RUNTIME_CAPABILITY)
}

// Under the requests' 2048 cap, so a project with more chats is read in pages instead of refused.
const SESSION_PAGE = 1024

/** One relation read, paged by session; a page the host cannot answer reads as empty. */
async function readPaged<T>(
  sessionIds: readonly string[],
  read: (page: string[]) => Promise<T[]>
): Promise<T[]> {
  const pages: string[][] = []
  for (let start = 0; start < sessionIds.length; start += SESSION_PAGE) {
    pages.push(sessionIds.slice(start, start + SESSION_PAGE))
  }
  const results = await Promise.all(pages.map((page) => read(page).catch(() => [])))
  return results.flat()
}

type HostLineage = {
  supported: boolean
  entries: AgentSessionLineageEntry[]
  references: AgentSessionReferenceLink[]
  sessions: AgentSessionLineageSession[]
}

async function readHostLineage(
  target: RuntimeClientTarget,
  sessionIds: readonly string[]
): Promise<HostLineage> {
  const [forks, references] = await Promise.all([
    hostSupportsAgentSessionFork(target),
    hostSupports(target, AGENT_SESSION_REFERENCES_RUNTIME_CAPABILITY)
  ])
  if (!forks) {
    return { supported: false, entries: [], references: [], sessions: [] }
  }
  const sessions: AgentSessionLineageSession[] = []
  const keepSessions = (value: unknown): void => {
    if (Array.isArray(value)) {
      sessions.push(...value.filter(isAgentSessionLineageSession))
    }
  }
  const [entries, links] = await Promise.all([
    readPaged(sessionIds, async (page) => {
      const result = await callStructuredAgentSession<{ entries?: unknown; sessions?: unknown }>(
        target,
        'agentSession.lineage',
        { sessionIds: page }
      )
      keepSessions(result.sessions)
      return Array.isArray(result.entries) ? result.entries.filter(isAgentSessionLineageEntry) : []
    }),
    references
      ? readPaged(sessionIds, async (page) => {
          const result = await callStructuredAgentSession<{ links?: unknown; sessions?: unknown }>(
            target,
            'agentSession.references',
            { sessionIds: page }
          )
          keepSessions(result.sessions)
          return Array.isArray(result.links) ? result.links.filter(isAgentSessionReferenceLink) : []
        })
      : Promise.resolve([])
  ])
  return { supported: true, entries, references: links, sessions }
}

export type ProjectMapLineage = {
  entries: ReadonlyMap<string, AgentSessionLineageEntry>
  /** Conversations sent messages referenced, from every host whose chats are on the map. */
  references: readonly AgentSessionReferenceLink[]
  /** Chats at either end of a fork or reference, keyed by session; closed ones draw as history. */
  history: ReadonlyMap<string, ProjectMapHistoryChat>
  /** Hosts known to predate forks: their chats show the fork action disabled, with the reason. */
  forkUnsupportedHosts: ReadonlySet<string>
}

const NO_HOSTS: ReadonlySet<string> = new Set()
const NO_HISTORY: ReadonlyMap<string, ProjectMapHistoryChat> = new Map()
const NO_REFERENCES: readonly AgentSessionReferenceLink[] = []
const EMPTY_LINEAGE: ProjectMapLineage = {
  entries: NO_LINEAGE,
  references: NO_REFERENCES,
  history: NO_HISTORY,
  forkUnsupportedHosts: NO_HOSTS
}

// Status changes come in bursts while agents run; one read covers the burst.
const REREAD_DELAY_MS = 400

/**
 * Forks and references recorded by every host whose chats are on the map. Re-read when the set of
 * chats changes, which is also when a new fork's chat appears, and whenever `revision` moves: the
 * page moves it on every status change, since a sent message is what records a reference.
 */
export function useProjectMapLineage(
  chats: ReadonlyMap<string, ProjectMapChat>,
  revision: string
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
    const readAll = async (): Promise<void> => {
      const reads = key
        ? key.split('|').map(async (part) => {
            const [host = '', ids] = part.split('=')
            const target = structuredAgentSessionTargetForHost(host || null)
            const read = target
              ? await readHostLineage(target, ids ? ids.split(',') : [])
              : { supported: true, entries: [], references: [], sessions: [] }
            return { host, ...read }
          })
        : []
      const hosts = await Promise.all(reads)
      if (cancelled) {
        return
      }
      const unsupported = hosts.filter((host) => !host.supported).map((host) => host.host)
      const pages = hosts.map((host) => host.entries)
      const history = new Map<string, ProjectMapHistoryChat>()
      for (const host of hosts) {
        for (const session of host.sessions) {
          history.set(session.sessionId, {
            ...session,
            executionHostId: normalizeExecutionHostId(host.host)
          })
        }
      }
      const entries = pages.some((page) => page.length > 0)
        ? mergeProjectMapLineage(pages)
        : NO_LINEAGE
      const references = withoutHandoffReferences(
        hosts.flatMap((host) => host.references),
        (child) => entries.get(child)
      )
      setLineage({
        entries,
        references: references.length > 0 ? references : NO_REFERENCES,
        history: history.size > 0 ? history : NO_HISTORY,
        forkUnsupportedHosts: unsupported.length > 0 ? new Set(unsupported) : NO_HOSTS
      })
    }
    const timer = window.setTimeout(() => void readAll(), REREAD_DELAY_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [key, revision])

  return lineage
}
