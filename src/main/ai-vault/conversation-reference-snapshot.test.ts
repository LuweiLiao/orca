import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentJournalRenderItem,
  AgentJournalSnapshot
} from '../../shared/agent-session-journal-types'
import { setAppEnvironment } from '../../shared/app-environment'
import { conversationReferenceSnapshotCount } from '../../shared/conversation-reference'
import { setStructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-registry'
import {
  createLocalConversationReference,
  readLocalConversationReference
} from './conversation-reference-reader'

const said = (
  itemId: string,
  role: 'user' | 'assistant',
  text: string,
  sequence: number
): AgentJournalRenderItem => ({
  itemId,
  revision: 1,
  sequence,
  observedAt: sequence,
  body: { kind: 'message', role, blocks: [{ type: 'text', text }] }
})

let userData = ''
let snapshot: AgentJournalSnapshot
let working = false

const at = (epoch: string, items: AgentJournalRenderItem[]): AgentJournalSnapshot => ({
  sessionId: 'claude_source',
  cursor: { epoch, sequence: items.at(-1)?.sequence ?? 0 },
  items,
  submissions: []
})

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'orca-reference-'))
  setAppEnvironment({
    getPath: () => userData,
    getAppPath: () => userData,
    getVersion: () => '0.0.0',
    isPackaged: () => false,
    onWillQuit: () => {},
    exit: () => {},
    getAppMetrics: () => []
  })
  working = false
  snapshot = at('e1', [said('a1', 'user', 'plan the map', 1), said('a2', 'assistant', 'lanes', 2)])
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: references read only `deps.store.getRecord`, `journalSnapshot` and `history`; the rest of the host is never reached.
  setStructuredAgentSessionHost({
    deps: {
      store: {
        getRecord: (sessionId: string) =>
          sessionId === 'claude_source'
            ? { sessionId, provider: 'claude', location: { workspaceId: 'repo::/main' } }
            : null
      }
    },
    journalSnapshot: vi.fn(async () => snapshot),
    history: vi.fn(async () => ({ page: { working } }))
  } as never)
})

afterEach(() => {
  setStructuredAgentSessionHost(null)
  rmSync(userData, { recursive: true, force: true })
})

const create = () =>
  createLocalConversationReference(
    {
      source: { kind: 'structured', sessionId: 'claude_source', workspaceId: 'repo::/main' },
      title: 'Plan'
    },
    async () => ({ sessions: [], issues: [], scannedAt: '' })
  )

const texts = async (uri: string) => {
  const page = await readLocalConversationReference({ reference: uri })
  return { texts: page?.messages.map((message) => message.text), warnings: page?.warnings }
}

describe('snapshot conversation references', () => {
  it('keeps reading what the source said when the reference was made', async () => {
    const reference = await create()
    expect(conversationReferenceSnapshotCount(reference.uri)).toBe(2)
    snapshot = at('e1', [...snapshot.items, said('a3', 'user', 'add forks', 3)])
    expect(await texts(reference.uri)).toEqual({ texts: ['plan the map', 'lanes'], warnings: [] })
  })

  it('leaves out the turn still running when the reference is made', async () => {
    snapshot = at('e1', [...snapshot.items, said('a3', 'user', 'add forks', 3)])
    working = true
    const reference = await create()
    expect(conversationReferenceSnapshotCount(reference.uri)).toBe(2)
    snapshot = at('e1', [...snapshot.items, said('a4', 'assistant', 'blue wires', 4)])
    expect((await texts(reference.uri)).texts).toEqual(['plan the map', 'lanes'])
  })

  it('reads the current conversation, and says so, after a rewind past the snapshot', async () => {
    const reference = await create()
    snapshot = at('e2', [said('b1', 'user', 'start over', 1)])
    expect(await texts(reference.uri)).toEqual({
      texts: ['start over'],
      warnings: [expect.stringContaining('rewound past')]
    })
  })
})
