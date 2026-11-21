import { useEffect, useMemo, useState } from 'react'
import { callStructuredAgentSession } from '@/runtime/native-chat/requests/structured-agent-session-call'
import { structuredAgentSessionTargetForHost } from '@/runtime/native-chat/session-ownership/structured-agent-session-owner'
import {
  ensureLocalRuntimeCapabilities,
  readLocalRuntimeCapabilitiesOrUnknown
} from '@/runtime/hosts/capabilities/local-runtime-capabilities'
import { runtimeEnvironmentSupportsCapability } from '@/runtime/rpc/compatibility/runtime-capability-proof'
import {
  AGENT_SESSION_REFERENCES_RUNTIME_CAPABILITY,
  isAgentSessionReferenceLink,
  isAgentSessionReferenceSession,
  type AgentSessionReferenceLink,
  type AgentSessionReferenceSession
} from '../../../../shared/agent-session/agent-session-reference-link'
import type { RuntimeClientTarget } from '../../../../shared/remote-runtime/host-catalog/runtime-client-target'
import { normalizeExecutionHostId } from '../../../../shared/execution-host/execution-host'
import type { ProjectMapChat, ProjectMapHistoryChat } from './project-map-lineage'

// Under the request's 2048 cap, so a project with more chats is read in pages instead of refused.
const SESSION_PAGE = 1024
// Status changes come in bursts while agents run; one read covers the burst.
const REREAD_DELAY_MS = 400

export type ProjectMapReferences = {
  links: readonly AgentSessionReferenceLink[]
  /** Chats at either end of a reference, so a closed one still draws as a history node. */
  history: ReadonlyMap<string, ProjectMapHistoryChat>
}

const NONE: ProjectMapReferences = { links: [], history: new Map() }

/** An older host answers neither the capability nor the method; its chats draw no reference wires. */
async function hostRecordsReferences(target: RuntimeClientTarget): Promise<boolean> {
  try {
    if (target.kind === 'local') {
      const capabilities =
        readLocalRuntimeCapabilitiesOrUnknown() ?? (await ensureLocalRuntimeCapabilities())
      return capabilities?.includes(AGENT_SESSION_REFERENCES_RUNTIME_CAPABILITY) === true
    }
    return await runtimeEnvironmentSupportsCapability(
      target.environmentId,
      AGENT_SESSION_REFERENCES_RUNTIME_CAPABILITY
    )
  } catch {
    return false
  }
}

async function readHostReferences(
  target: RuntimeClientTarget,
  sessionIds: readonly string[]
): Promise<{ links: AgentSessionReferenceLink[]; sessions: AgentSessionReferenceSession[] }> {
  const links: AgentSessionReferenceLink[] = []
  const sessions: AgentSessionReferenceSession[] = []
  for (let start = 0; start < sessionIds.length; start += SESSION_PAGE) {
    try {
      const reply = await callStructuredAgentSession<{ links?: unknown; sessions?: unknown }>(
        target,
        'agentSession.references',
        { sessionIds: sessionIds.slice(start, start + SESSION_PAGE) }
      )
      if (Array.isArray(reply.links)) {
        links.push(...reply.links.filter(isAgentSessionReferenceLink))
      }
      if (Array.isArray(reply.sessions)) {
        sessions.push(...reply.sessions.filter(isAgentSessionReferenceSession))
      }
    } catch {
      // A host that cannot answer draws its chats without reference wires, as an older one does.
    }
  }
  return { links, sessions }
}

/**
 * Conversation references recorded by every host whose chats are on the map. Re-read when the set
 * of chats changes and whenever `revision` moves: a sent message is what records a reference.
 */
export function useProjectMapReferences(
  chats: ReadonlyMap<string, ProjectMapChat>,
  revision: number
): ProjectMapReferences {
  const key = useMemo(() => {
    const byHost = new Map<string, string[]>()
    for (const chat of chats.values()) {
      const host = chat.executionHostId ?? ''
      byHost.set(host, [...(byHost.get(host) ?? []), chat.sessionId])
    }
    return [...byHost]
      .map(([host, ids]) => `${host}=${ids.toSorted().join(',')}`)
      .toSorted()
      .join('|')
  }, [chats])
  const [state, setState] = useState(NONE)

  useEffect(() => {
    let cancelled = false
    const readAll = async (): Promise<void> => {
      const hosts = await Promise.all(
        (key ? key.split('|') : []).map(async (part) => {
          const [host = '', ids] = part.split('=')
          const target = structuredAgentSessionTargetForHost(host || null)
          if (!target || !(await hostRecordsReferences(target))) {
            return { host, links: [], sessions: [] }
          }
          return { host, ...(await readHostReferences(target, ids ? ids.split(',') : [])) }
        })
      )
      if (cancelled) {
        return
      }
      const history = new Map<string, ProjectMapHistoryChat>()
      for (const { host, sessions } of hosts) {
        for (const session of sessions) {
          history.set(session.sessionId, {
            sessionId: session.sessionId,
            agent: session.agent,
            executionHostId: host ? normalizeExecutionHostId(host) : null,
            workspaceId: session.workspaceId,
            title: session.title?.trim() || null
          })
        }
      }
      const links = hosts.flatMap((host) => host.links)
      setState(links.length === 0 ? NONE : { links, history })
    }
    const timer = window.setTimeout(() => void readAll(), REREAD_DELAY_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [key, revision])

  return state
}
