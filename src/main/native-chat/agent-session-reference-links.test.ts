import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type {
  AgentJournalRenderItem,
  AgentJournalSnapshot
} from '../../shared/agent-session-journal-types'
import { setAppEnvironment } from '../../shared/app-environment'
import { conversationReferenceToken } from '../../shared/conversation-reference'
import { saveConversationReference } from '../ai-vault/conversation-reference-store'
import {
  agentSessionReferenceView,
  conversationReferenceLinks
} from './agent-session-reference-links'

const said = (itemId: string, role: 'user' | 'assistant', text: string, sequence: number) =>
  ({
    itemId,
    revision: 1,
    sequence,
    observedAt: sequence,
    body: { kind: 'message', role, blocks: [{ type: 'text', text }] }
  }) satisfies AgentJournalRenderItem

const journal = (items: AgentJournalRenderItem[]): AgentJournalSnapshot => ({
  sessionId: 'claude_target',
  cursor: { epoch: 'e', sequence: items.length },
  items,
  submissions: []
})

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
    const host = {
      journalSnapshot: async () =>
        journal([
          said('m1', 'user', 'hi', 1),
          said('m2', 'assistant', 'yo', 2),
          said('m3', 'user', text, 3)
        ])
    }
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
    const host = { journalSnapshot: async () => journal([]) }
    expect(
      await conversationReferenceLinks(host, {
        sessionId: 'claude_target',
        messageId: 'm1',
        blocks: [{ type: 'text', text: 'no links here' }]
      })
    ).toEqual([])
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
