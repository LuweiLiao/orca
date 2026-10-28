import {
  agentSessionLineageSources,
  type AgentSessionLineageEntry,
  type AgentSessionLineageSession
} from '../../shared/agent-session-fork'
import type { AgentSessionRecord } from '../../shared/agent-session-record'

type LineageRecord = Pick<AgentSessionRecord, 'provider' | 'conversationName'> & {
  location: Pick<AgentSessionRecord['location'], 'workspaceId'>
}

/**
 * The forks connected to the wanted chats, followed through chats that are no longer open, and a
 * description of every chat they touch. A fork whose child was never made is left out.
 */
export function agentSessionLineageView(
  entries: readonly AgentSessionLineageEntry[],
  getRecord: (sessionId: string) => LineageRecord | null | undefined,
  wanted: readonly string[] | undefined
): { entries: AgentSessionLineageEntry[]; sessions: AgentSessionLineageSession[] } {
  const made = entries.filter((entry) => getRecord(entry.childSessionId))
  // A merged child is joined to every chat it was handed, not only the primary one.
  const ends = (entry: AgentSessionLineageEntry): string[] => [
    entry.childSessionId,
    ...agentSessionLineageSources(entry).map((source) => source.sessionId)
  ]
  let kept = made
  if (wanted) {
    const reached = new Set(wanted)
    const keep = new Set<AgentSessionLineageEntry>()
    // A closed chat between two open ones still joins them; the table is small enough to sweep.
    for (let grew = true; grew;) {
      grew = false
      for (const entry of made) {
        if (!keep.has(entry) && ends(entry).some((sessionId) => reached.has(sessionId))) {
          keep.add(entry)
          ends(entry).forEach((sessionId) => reached.add(sessionId))
          grew = true
        }
      }
    }
    kept = made.filter((entry) => keep.has(entry))
  }
  const sessions = new Map<string, AgentSessionLineageSession>()
  for (const entry of kept) {
    for (const sessionId of ends(entry)) {
      const record = sessions.has(sessionId) ? null : getRecord(sessionId)
      if (record) {
        sessions.set(sessionId, {
          sessionId,
          agent: record.provider,
          workspaceId: record.location.workspaceId,
          title: record.conversationName ?? null
        })
      }
    }
  }
  return { entries: kept, sessions: [...sessions.values()] }
}
