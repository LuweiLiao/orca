import { describe, expect, it, vi } from 'vitest'
import { mobileChatRelationMenuActions } from './mobile-chat-relation-menu'
import type { MobileChatRelation } from './mobile-chat-relations'

const relation: MobileChatRelation = {
  kind: 'forked-into',
  sessionId: 'claude_child',
  title: 'Try ELK',
  detail: 'Handoff',
  agent: 'claude'
}
const args = (hostCapabilities: string[], handoff: (() => void) | null = vi.fn()) => ({
  relation,
  hostCapabilities,
  open: vi.fn(),
  showTurns: vi.fn(),
  markRead: vi.fn(),
  handoff
})
const labels = (input: ReturnType<typeof args>) =>
  mobileChatRelationMenuActions(input).map((action) => action.label)

describe('mobileChatRelationMenuActions', () => {
  it('offers every action a current host supports', () => {
    expect(
      labels(args(['agent-session.conversation-outline.v1', 'agent-session.attention-ack.v1']))
    ).toEqual(['Open', 'Turns', 'Mark as read', 'Hand off'])
  })

  it('drops what an older host or workspace cannot do, and keeps Open', () => {
    expect(labels(args([], null))).toEqual(['Open'])
    expect(labels(args(['agent-session.conversation-outline.v1'], null))).toEqual(['Open', 'Turns'])
  })

  it('offers nothing for a related chat on another host', () => {
    expect(
      mobileChatRelationMenuActions({ ...args([]), relation: { ...relation, sessionId: null } })
    ).toEqual([])
  })
})
