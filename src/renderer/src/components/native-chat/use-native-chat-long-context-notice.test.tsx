// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SessionOptionDescriptor } from '../../../../shared/native-chat-session-options'

const launch = vi.hoisted(() => vi.fn(() => ({ surface: { kind: 'host-published' } })))
vi.mock('@/lib/launch-agent-in-new-tab', () => ({ launchAgentInNewTab: launch }))

import {
  useNativeChatLongContextNotice,
  type NativeChatLongContextNoticeTransport
} from './use-native-chat-long-context-notice'

const MODEL: SessionOptionDescriptor = {
  id: 'model',
  label: 'Model',
  category: 'model',
  kind: { type: 'select', currentValue: 'gpt-5.5', choices: [] },
  valueSource: 'reported',
  transport: 'agent-session',
  settable: true
}

function transport(
  sessionId: string,
  usedTokens: number,
  overrides: Partial<NativeChatLongContextNoticeTransport> = {}
): NativeChatLongContextNoticeTransport {
  return {
    sessionId,
    worktreeId: 'wt',
    optionSnapshot: [MODEL],
    conversationCommands: ['clear', 'compact'],
    contextUsage: {
      usedTokens,
      windowTokens: 1_000_000,
      percentage: Math.round(usedTokens / 10_000),
      estimated: false,
      categories: []
    },
    dispatchCommand: vi.fn(async () => ({ handled: true, accepted: true, error: null })),
    onError: vi.fn(),
    ...overrides
  }
}

function render(initial: NativeChatLongContextNoticeTransport) {
  return renderHook(
    ({ value }) =>
      useNativeChatLongContextNotice({ transport: value, tabId: 'tab', agent: 'codex' }),
    { initialProps: { value: initial } }
  )
}

describe('useNativeChatLongContextNotice', () => {
  it('stays quiet below the tier and for models without one', () => {
    expect(render(transport('a', 200_000)).result.current).toBeNull()
    const noTier = transport('b', 400_000, {
      optionSnapshot: [
        { ...MODEL, kind: { type: 'select', currentValue: 'gpt-5.2-codex', choices: [] } }
      ]
    })
    expect(render(noTier).result.current).toBeNull()
  })

  it('offers /compact first and a new chat beside it', async () => {
    const value = transport('c', 300_000)
    const { result } = render(value)
    expect(result.current?.text).toContain('272k')
    expect(result.current?.secondaryAction?.label).toBe('New chat')
    await act(async () => result.current?.action?.onClick())
    expect(value.dispatchCommand).toHaveBeenCalledWith('/compact')
    act(() => result.current?.secondaryAction?.onClick())
    expect(launch).toHaveBeenCalledWith(
      expect.objectContaining({ agent: 'codex', worktreeId: 'wt', requestedSurface: 'chat' })
    )
  })

  it('offers only a new chat where the agent cannot compact', () => {
    const { result } = render(transport('d', 300_000, { conversationCommands: [] }))
    expect(result.current?.action?.label).toBe('New chat')
    expect(result.current?.secondaryAction).toBeUndefined()
  })

  it('a dismissed warning returns when the chat crosses the tier, and after it drops back', () => {
    const { result, rerender } = render(transport('e', 250_000))
    act(() => result.current?.onDismiss?.())
    expect(result.current).toBeNull()
    rerender({ value: transport('e', 300_000) })
    expect(result.current?.key).toBe('long-context-pricing')
    act(() => result.current?.onDismiss?.())
    rerender({ value: transport('e', 250_000) })
    expect(result.current).toBeNull()
    rerender({ value: transport('e', 40_000) })
    rerender({ value: transport('e', 250_000) })
    expect(result.current).not.toBeNull()
  })
})
