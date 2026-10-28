import { mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setAppEnvironment } from '../../shared/app-environment'
import {
  conversationSummarySessions,
  loadConversationSummary,
  saveConversationSummary
} from './conversation-summary-store'

let userData = ''
const record = {
  text: 'Goal: ship',
  throughMessageCount: 4,
  throughMessageId: 'm4',
  generatedAt: 1,
  edited: false
}

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'orca-summary-'))
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

describe('conversation summary store', () => {
  it('keeps a summary per chat with the message it stopped at', async () => {
    await saveConversationSummary('chat-a', record)
    expect(await loadConversationSummary('chat-a')).toEqual(record)
    expect(await loadConversationSummary('chat-b')).toBeNull()
  })

  it('overwrites on regenerate or edit and leaves no staging file', async () => {
    await saveConversationSummary('chat-a', record)
    await saveConversationSummary('chat-a', { ...record, text: 'edited', edited: true })
    expect((await loadConversationSummary('chat-a'))?.text).toBe('edited')
    expect(readdirSync(join(userData, 'conversation-summaries'))).toHaveLength(1)
  })

  it('lists which chats have one without reading them', async () => {
    await saveConversationSummary('chat-a', record)
    expect(await conversationSummarySessions(['chat-a', 'chat-b'])).toEqual(['chat-a'])
  })

  it('ignores a file that does not describe this chat', async () => {
    await saveConversationSummary('chat-a', record)
    const [file] = readdirSync(join(userData, 'conversation-summaries'))
    writeFileSync(join(userData, 'conversation-summaries', file!), '{"sessionId":"other"}')
    expect(await loadConversationSummary('chat-a')).toBeNull()
  })
})
