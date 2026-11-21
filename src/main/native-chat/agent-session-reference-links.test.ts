import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentJournalRenderItem } from '../../shared/agent-session/journal/agent-session-journal-types'
import { setAppEnvironment } from '../../shared/app-lifecycle/app-environment'
import { conversationReferenceToken } from '../../shared/conversation-reference'
import { listConversationReferenceLinks } from '../ai-vault/conversation-reference-link-store'
import { saveConversationReference } from '../ai-vault/conversation-reference-store'
import {
  agentSessionReferenceView,
  conversationReferenceLinks,
  recordConversationReferenceLinks
} from './agent-session-reference-links'

const said = (itemId: string, role: 'user' | 'assistant', text: string, sequence: number) =>
  ({
    itemId,
    revision: 1,
    sequence,
    observedAt: sequence,
    body: { kind: 'message', role, blocks: [{ type: 'text', text }] }
  }) satisfies AgentJournalRenderItem

const historyOf = (items: AgentJournalRenderItem[]) => {
  const cursor = { epoch: 'e', sequence: items.length }
  return async () => ({
    ok: true,
    page: {
      epoch: 'e',
      items,
      submissions: [],
      window: { oldest: null, newest: cursor, nextCursor: cursor },
      liveCursor: cursor,
      hasOlder: false,
      working: false
    }
  })
}

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: references read only `history`; one page carries a short chat.
const hostWith = (items: AgentJournalRenderItem[]) => ({ history: historyOf(items) }) as never

let userData = ''

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'orca-reference-links-'))
  setAppEnvironment({
    getPath: () => userData,
    getAppPath: () => userData,
    getVersion: () => '0.0.0',
    isPackaged: () => false,
    onWillQuit: () => {},
    exit: () => {},
    getAppMetrics: () => []
  })
})

afterEach(() => rmSync(userData, { recursive: true, force: true }))

describe('conversation reference links', () => {
  it('records each reference a sent message carried, at its place in the chat', async () => {
    const stored = await saveConversationReference(
      {
        source: { kind: 'structured', sessionId: 'claude_source', workspaceId: 'repo::/main' },
        title: 'Plan the map'
      },
      'claude',
      { journalItemId: 'i', journalEpoch: 'e', journalSequence: 9, messageCount: 9 }
    )
    const elsewhere =
      'orca-conversation://reference/00000000-0000-4000-8000-000000000000?host=runtime%3Apaired'
    const text = `Compare ${conversationReferenceToken(stored)} with [Remote](${elsewhere})`
    const host = hostWith([
      said('m1', 'user', 'hi', 1),
      said('m2', 'assistant', 'yo', 2),
      said('m3', 'user', text, 3)
    ])
    const links = await conversationReferenceLinks(
      host,
      { sessionId: 'claude_target', messageId: 'm3', blocks: [{ type: 'text', text }] },
      7
    )
    expect(links).toEqual([
      {
        targetSessionId: 'claude_target',
        messageId: 'm3',
        messageIndex: 2,
        referenceUri: stored.uri,
        title: 'Plan the map',
        source: { sessionId: 'claude_source', workspaceId: 'repo::/main' },
        sourceMessageCount: 9,
        createdAt: 7
      },
      expect.objectContaining({ title: 'Remote', source: null, sourceMessageCount: null })
    ])
  })

  it('reads nothing for a message without references', async () => {
    expect(
      await conversationReferenceLinks(hostWith([]), {
        sessionId: 'claude_target',
        messageId: 'm1',
        blocks: [{ type: 'text', text: 'no links here' }]
      })
    ).toEqual([])
  })

  it('keeps one link of each when a send is recorded twice', async () => {
    const uri = 'orca-conversation://reference/00000000-0000-4000-8000-000000000000?host=local'
    const text = `See [Plan](${uri})`
    const sent = { sessionId: 'claude_target', messageId: 'm1', blocks: [{ type: 'text', text }] }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: recording reads only `history` and `deps.logger`.
    const recording = {
      history: historyOf([said('m1', 'user', text, 1)]),
      deps: { logger: { warn: () => {} } }
    } as never
    await recordConversationReferenceLinks(recording, sent)
    await recordConversationReferenceLinks(recording, sent)
    expect(await listConversationReferenceLinks()).toHaveLength(1)
  })

  it('returns the links touching the wanted chats from either end', () => {
    const record = { provider: 'claude', conversationName: 'x', location: { workspaceId: 'w' } }
    const link = {
      targetSessionId: 'claude_target',
      messageId: 'm',
      messageIndex: 0,
      referenceUri: 'u',
      title: 't',
      source: { sessionId: 'claude_source', workspaceId: 'w' },
      sourceMessageCount: null,
      createdAt: 0
    }
    const view = agentSessionReferenceView([link], () => record, ['claude_source'])
    expect(view.links).toEqual([link])
    expect(view.sessions.map((session) => session.sessionId)).toEqual([
      'claude_target',
      'claude_source'
    ])
    expect(agentSessionReferenceView([link], () => record, ['claude_other']).links).toEqual([])
  })
})
