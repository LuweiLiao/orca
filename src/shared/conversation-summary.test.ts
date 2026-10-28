import { describe, expect, it } from 'vitest'
import { AI_VAULT_RUNTIME_CAPABILITIES } from './ai-vault-runtime-capabilities'
import { CONVERSATION_SUMMARY_CAPABILITY, conversationSummaryStale } from './conversation-summary'
import {
  buildConversationSummaryPrompt,
  CONVERSATION_SUMMARY_PROMPT_OPENING,
  sanitizeGeneratedConversationSummary
} from './conversation-summary-prompt'

const summary = { throughMessageCount: 2, throughMessageId: 'b' }

describe('conversationSummaryStale', () => {
  it('is fresh while the chat still ends where the summary stopped', () => {
    expect(conversationSummaryStale(summary, ['a', 'b'])).toBe(false)
  })

  it('is stale once the chat has new messages', () => {
    expect(conversationSummaryStale(summary, ['a', 'b', 'c'])).toBe(true)
  })

  it('is stale when a rewind removed or replaced the last message it saw', () => {
    expect(conversationSummaryStale(summary, ['a'])).toBe(true)
    expect(conversationSummaryStale(summary, ['a', 'x'])).toBe(true)
  })

  it('has nothing to be stale without a summary', () => {
    expect(conversationSummaryStale(null, ['a'])).toBe(false)
  })
})

describe('conversation summary capability', () => {
  it('is advertised by the host', () => {
    expect(AI_VAULT_RUNTIME_CAPABILITIES).toContain(CONVERSATION_SUMMARY_CAPABILITY)
    expect(CONVERSATION_SUMMARY_CAPABILITY).toBe('conversation.summary.v1')
  })
})

describe('conversation summary prompt', () => {
  it('opens with the line Session History hides and keeps the newest turns when cut', () => {
    const messages = Array.from({ length: 80 }, (_, index) => ({
      role: 'user' as const,
      text: `${index} ${'x'.repeat(1900)}`
    }))
    const prompt = buildConversationSummaryPrompt(messages)
    expect(prompt.startsWith(CONVERSATION_SUMMARY_PROMPT_OPENING)).toBe(true)
    expect(prompt).toContain('79 xxx')
    expect(prompt).not.toContain('User: 0 xxx')
    expect(prompt).toMatch(/oldest messages are not shown/)
  })

  it('refuses an empty or reasoning-only answer', () => {
    expect(sanitizeGeneratedConversationSummary('   ')).toBeNull()
    expect(sanitizeGeneratedConversationSummary('<think>hmm')).toBeNull()
    expect(sanitizeGeneratedConversationSummary('Goal: ship it')).toBe('Goal: ship it')
  })
})
