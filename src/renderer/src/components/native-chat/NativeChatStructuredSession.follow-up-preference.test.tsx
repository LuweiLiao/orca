// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import { useAppStore } from '@/store'
const { mocks, moduleFactories, resetStructuredSessionMocks } = await vi.hoisted(async () =>
  (await import('./NativeChatStructuredSession.test-harness')).createStructuredSessionMocks()
)
vi.mock('@/runtime/structured-agent-session-client', () =>
  moduleFactories.structuredAgentSessionClient()
)
vi.mock('./use-structured-agent-session', () => moduleFactories.useStructuredAgentSession())
vi.mock('./use-native-chat-font-size', () => moduleFactories.useNativeChatFontSize())
vi.mock('./use-native-chat-file-link-context', () => moduleFactories.useNativeChatFileLinkContext())
vi.mock('./use-native-chat-tab-owner', () => moduleFactories.useNativeChatTabOwner())
vi.mock('./use-native-chat-file-link-click', () => moduleFactories.useNativeChatFileLinkClick())
vi.mock('./NativeChatMessageList', () => moduleFactories.nativeChatMessageList())
vi.mock('./NativeChatComposer', () => moduleFactories.nativeChatComposer())
vi.mock('./NativeChatEmptyState', () => moduleFactories.nativeChatEmptyState())
vi.mock('./NativeChatApprovalCard', () => moduleFactories.nativeChatApprovalCard())
vi.mock('./NativeChatQuestionCard', () => moduleFactories.nativeChatQuestionCard())
import { NativeChatStructuredSession } from './NativeChatStructuredSession'
afterEach(() => {
  cleanup()
  resetStructuredSessionMocks()
})
it('isolates mounted chats from unrelated settings and renders their live follow-up choice', async () => {
  const original = useAppStore.getState().settings
  const settings = { ...getDefaultSettings('/tmp'), nativeChatQueueFollowUps: false }
  useAppStore.setState({ settings })
  const view = render(
    <>
      {['local-chat', 'ssh-chat'].map((sessionId) => (
        <NativeChatStructuredSession
          key={sessionId}
          isVisible
          isFocusedGroup
          tabId={sessionId}
          sessionId={sessionId}
          target={
            sessionId === 'local-chat'
              ? { kind: 'local' }
              : { kind: 'environment', environmentId: 'ssh-host' }
          }
          agent="codex"
        />
      ))}
    </>
  )
  try {
    await act(async () => {})
    mocks.controllerRender.mockClear()
    act(() => useAppStore.setState({ settings: { ...settings, nativeChatQueueFollowUps: true } }))
    expect(new Set(mocks.controllerRender.mock.calls.map(([sessionId]) => sessionId))).toEqual(
      new Set(['local-chat', 'ssh-chat'])
    )
    expect(mocks.controllerRender.mock.calls.every(([, queue]) => queue === true)).toBe(true)
    mocks.controllerRender.mockClear()
    act(() => useAppStore.setState({ settings }))
    expect(new Set(mocks.controllerRender.mock.calls.map(([sessionId]) => sessionId))).toEqual(
      new Set(['local-chat', 'ssh-chat'])
    )
    expect(mocks.controllerRender.mock.calls.every(([, queue]) => queue === false)).toBe(true)
  } finally {
    view.unmount()
    useAppStore.setState({ settings: original })
  }
})
