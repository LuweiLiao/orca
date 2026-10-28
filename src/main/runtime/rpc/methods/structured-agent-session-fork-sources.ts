// The chats a fork reads from: the primary source and, for a merge, the others. Each must be on
// this host, cut where it still has that place, and idle when the cut takes its last turn.

import type {
  AgentSessionForkCut,
  AgentSessionForkParams,
  AgentSessionLineageEntry
} from '../../../../shared/agent-session-fork'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import type { AgentSessionRecord } from '../../../../shared/agent-session-record'
import { conversationReferenceToken } from '../../../../shared/conversation-reference'
import { saveConversationReference } from '../../../ai-vault/conversation-reference-store'
import {
  forkSourceMessages,
  type ForkSourceMessages
} from '../../../native-chat/agent-session-fork-source'
import type { requireStructuredHost } from './structured-agent-session-gate'

type Host = ReturnType<typeof requireStructuredHost>
type Lineage = { get: (childSessionId: string) => AgentSessionLineageEntry | null | undefined }

export type ResolvedForkSource = {
  record: AgentSessionRecord
  taken: ForkSourceMessages
  forkPoint: AgentSessionLineageEntry | null
}

/** One source, read under the same rules a single-source fork always had. */
export async function resolveForkSource(
  host: Host,
  lineage: Lineage,
  sessionId: string,
  cut: AgentSessionForkParams['cut']
): Promise<ResolvedForkSource> {
  const record = host.deps.store.getRecord(sessionId)
  if (
    !record ||
    record.location.executionHostId !== LOCAL_EXECUTION_HOST_ID ||
    record.location.wslDistro !== null
  ) {
    throw new Error(
      `${titleOf(record, sessionId)} is not on this host, so it cannot be continued here.`
    )
  }
  const forkPoint = cut.kind === 'fork-point' ? (lineage.get(cut.childSessionId) ?? null) : null
  if (forkPoint && forkPoint.sourceSessionId !== sessionId) {
    throw new Error('That fork point belongs to another chat.')
  }
  // Idle on both sides of the read: a turn that began in between would hand over a half reply.
  // Journal turn rows are not proof here; a host that died mid-turn leaves them `running`.
  const refuseWhileWorking = async (): Promise<void> => {
    const page = await host.history({ sessionId, direction: 'tail', limit: 1 })
    if (page.page.working) {
      throw new Error(
        `${titleOf(record, sessionId)} is still working. Start from it after its turn ends.`
      )
    }
  }
  const read = async (): Promise<ForkSourceMessages> =>
    forkSourceMessages(await host.journalSnapshot(sessionId), cut, forkPoint)
  const guarded = async (): Promise<ForkSourceMessages> => {
    await refuseWhileWorking()
    const taken = await read()
    await refuseWhileWorking()
    return taken
  }
  if (cut.kind === 'latest') {
    return { record, taken: await guarded(), forkPoint }
  }
  const taken = await read()
  // A message in the last turn takes that whole turn, so it waits for the turn as `latest` does.
  return {
    record,
    taken: cut.kind === 'message' && taken.reachesLatest ? await guarded() : taken,
    forkPoint
  }
}

/** The merge's other sources, each named once and none of them the chat being made. */
export async function resolveMergeSources(
  host: Host,
  lineage: Lineage,
  params: Pick<AgentSessionForkParams, 'sourceSessionId' | 'mergeSources'>,
  childSessionId: string
): Promise<ResolvedForkSource[]> {
  const merged = params.mergeSources ?? []
  const ids = [params.sourceSessionId, ...merged.map((source) => source.sessionId)]
  if (new Set(ids).size !== ids.length) {
    throw new Error('A chat is listed more than once in this merge.')
  }
  if (ids.includes(childSessionId)) {
    throw new Error('A chat cannot be merged into itself.')
  }
  const resolved: ResolvedForkSource[] = []
  // One at a time: each source's idle check stays next to its own read.
  for (const source of merged) {
    resolved.push(await resolveForkSource(host, lineage, source.sessionId, source.cut))
  }
  return resolved
}

/** A snapshot reference to a source at its cut, for the messages a hand-off had to leave out. */
export async function forkSourceReference(
  record: AgentSessionRecord,
  cut: Omit<AgentSessionForkCut, 'providerSessionId' | 'providerMessageId'>
): Promise<string> {
  const reference = await saveConversationReference(
    {
      source: {
        kind: 'structured',
        sessionId: record.sessionId,
        workspaceId: record.location.workspaceId
      },
      title: record.conversationName ?? record.provider
    },
    record.provider,
    {
      journalItemId: cut.journalItemId,
      journalEpoch: cut.journalEpoch,
      journalSequence: cut.journalSequence,
      messageCount: cut.messageCount
    }
  )
  return conversationReferenceToken(reference)
}

function titleOf(record: AgentSessionRecord | null | undefined, sessionId: string): string {
  return record?.conversationName ? `"${record.conversationName}"` : `The chat ${sessionId}`
}
