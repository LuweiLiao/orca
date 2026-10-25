import { afterEach, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../shared/constants'
import { normalizeSourceControlAiSettings } from '../../shared/source-control-ai-settings'
import type { GlobalSettings } from '../../shared/global-settings-types'
import { hostTestState } from '../native-chat/agent-session-wire/structured-agent-session-host-test-harness'
import { setStructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-registry'
import { installStructuredChatNamingRecovery } from './structured-chat-naming-recovery'

afterEach(() => setStructuredAgentSessionHost(null))

it('recovers at startup and after naming changes, but not unrelated or unchanged settings', async () => {
  const { host } = hostTestState()
  setStructuredAgentSessionHost(host)
  const settings = getDefaultSettings('/isolated')
  settings.defaultTuiAgent = 'codex'
  let notify: (updates: Partial<GlobalSettings>, settings: GlobalSettings) => void = () => {}
  const stop = vi.fn()
  const store = {
    getSettings: () => settings,
    onSettingsChanged: (listener: typeof notify) => {
      notify = listener
      return stop
    }
  }
  const recover = vi.fn(async () => {})
  installStructuredChatNamingRecovery(store, host, recover)
  installStructuredChatNamingRecovery(store, host, recover)
  expect(recover).toHaveBeenCalledTimes(1)
  settings.uiLanguage = 'zh'
  notify({ uiLanguage: 'zh' }, settings)
  expect(recover).toHaveBeenCalledTimes(1)
  settings.sourceControlAi = {
    ...normalizeSourceControlAiSettings(settings.sourceControlAi),
    actions: { conversationName: { agentArgs: '--model working' } }
  }
  notify({ sourceControlAi: settings.sourceControlAi }, settings)
  expect(recover).toHaveBeenCalledTimes(2)
  notify({ sourceControlAi: settings.sourceControlAi }, settings)
  expect(recover).toHaveBeenCalledTimes(2)
  settings.nativeChatAutoName = false
  notify({ nativeChatAutoName: false }, settings)
  expect(recover).toHaveBeenCalledTimes(2)
  settings.nativeChatAutoName = true
  notify({ nativeChatAutoName: true }, settings)
  expect(recover).toHaveBeenCalledTimes(3)
  setStructuredAgentSessionHost(null)
  notify({}, settings)
  expect(stop).toHaveBeenCalledTimes(1)
})
