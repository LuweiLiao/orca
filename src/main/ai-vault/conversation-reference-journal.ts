import {
  AGENT_SESSION_HISTORY_MAX_LIMIT,
  type AgentSessionHistoryPage
} from '../../shared/agent-session/agent-session-wire'
import type { AgentJournalSnapshot } from '../../shared/agent-session/journal/agent-session-journal-types'
import type { StructuredAgentSessionHost } from '../native-chat/agent-session-wire/host/structured-agent-session-host'

// A reference reads a whole chat; this bounds a runaway walk, not an ordinary long conversation.
const MAX_REFERENCE_HISTORY_PAGES = 500

/** A chat's journal as a reference reads it: every history page, oldest first, from one epoch. */
export async function readConversationReferenceJournal(
  host: Pick<StructuredAgentSessionHost, 'history'>,
  sessionId: string
): Promise<AgentJournalSnapshot> {
  const pages: AgentSessionHistoryPage[] = []
  let request: Parameters<StructuredAgentSessionHost['history']>[0] = {
    sessionId,
    direction: 'tail',
    limit: AGENT_SESSION_HISTORY_MAX_LIMIT
  }
  for (let read = 0; read < MAX_REFERENCE_HISTORY_PAGES; read++) {
    const result = await host.history(request)
    if (!result.ok) {
      throw new Error('The referenced chat changed while it was read; try again.')
    }
    const { page } = result
    if (pages.length > 0 && page.epoch !== pages[0]!.epoch) {
      throw new Error('The referenced chat changed while it was read; try again.')
    }
    pages.push(page)
    if (!page.hasOlder || !page.window.oldest) {
      break
    }
    request = {
      sessionId,
      direction: 'before',
      cursor: page.window.oldest,
      limit: AGENT_SESSION_HISTORY_MAX_LIMIT
    }
  }
  const newest = pages[0]
  if (!newest) {
    throw new Error('The referenced chat could not be read.')
  }
  const items = pages.toReversed().flatMap((page) => page.items)
  const submissions = new Map(
    pages.flatMap((page) => page.submissions).map((entry) => [entry.clientMessageId, entry])
  )
  return {
    sessionId,
    cursor: newest.liveCursor ?? newest.window.newest ?? newest.window.nextCursor,
    items,
    submissions: [...submissions.values()]
  }
}
