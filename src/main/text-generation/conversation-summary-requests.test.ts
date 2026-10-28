import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setAppEnvironment } from '../../shared/app-environment'
import { loadConversationSummary } from '../ai-vault/conversation-summary-store'

const generate = vi.hoisted(() => vi.fn())
const cancelLocal = vi.hoisted(() => vi.fn())
vi.mock('./conversation-summary-text-generation', () => ({
  generateConversationSummary: generate,
  cancelConversationSummaryLocal: cancelLocal
}))
vi.mock('./commit-message-text-generation', () => ({
  resolveTextGenerationParams: () => ({ ok: true, params: { agentId: 'claude' } })
}))
vi.mock('./commit-message-agent-environment', () => ({
  prepareLocalCommitMessageAgentEnv: async () => ({ ok: true })
}))

import {
  cancelConversationSummaryRequest,
  conversationSummaryState,
  generateConversationSummaryRequest
} from './conversation-summary-requests'

const host = { getSettings: vi.fn(), getAgentEnvironment: () => undefined }
const chat = {
  sessionId: 'chat-a',
  cwd: '/work',
  messages: [
    { id: 'm1', role: 'user' as const, text: 'plan' },
    { id: 'm2', role: 'assistant' as const, text: 'lanes' }
  ]
}
let userData = ''

beforeEach(() => {
  generate.mockReset()
  cancelLocal.mockReset()
  userData = mkdtempSync(join(tmpdir(), 'orca-summary-req-'))
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

describe('generateConversationSummaryRequest', () => {
  it('runs no model unless asked, and reading the state never generates', async () => {
    expect(await conversationSummaryState('chat-a', ['m1'])).toEqual({
      summary: null,
      stale: false
    })
    expect(generate).not.toHaveBeenCalled()
  })

  it('saves the summary with the last message it saw, and marks it stale after new messages', async () => {
    generate.mockResolvedValue({ success: true, text: 'Goal: map', agentLabel: 'Claude' })
    const result = await generateConversationSummaryRequest(host, 'desktop', chat, 'r1')
    expect(result).toMatchObject({ success: true, state: { stale: false } })
    expect((await loadConversationSummary('chat-a'))?.throughMessageId).toBe('m2')
    expect(await conversationSummaryState('chat-a', ['m1', 'm2', 'm3'])).toMatchObject({
      stale: true
    })
  })

  it('writes nothing when the model fails', async () => {
    generate.mockResolvedValue({ success: false, error: 'no agent' })
    expect(await generateConversationSummaryRequest(host, 'desktop', chat, 'r1')).toEqual({
      success: false,
      error: 'no agent'
    })
    expect(await loadConversationSummary('chat-a')).toBeNull()
  })

  it('refuses a second summary while one runs, and a cancel discards the first result', async () => {
    let finish: (value: unknown) => void = () => {}
    generate.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const first = generateConversationSummaryRequest(host, 'desktop', chat, 'r1')
    await vi.waitFor(() => expect(generate).toHaveBeenCalled())
    expect(await generateConversationSummaryRequest(host, 'desktop', chat, 'r2')).toMatchObject({
      success: false
    })
    cancelConversationSummaryRequest('desktop', { sessionId: 'chat-a', requestId: 'r1' })
    expect(cancelLocal).toHaveBeenCalledWith('/work')
    finish({ success: true, text: 'late' })
    expect(await first).toMatchObject({ success: false, canceled: true })
    expect(await loadConversationSummary('chat-a')).toBeNull()
  })

  it('does not let another caller cancel it', async () => {
    cancelConversationSummaryRequest('someone-else', { sessionId: 'chat-a', requestId: 'r1' })
    expect(cancelLocal).not.toHaveBeenCalled()
  })
})
