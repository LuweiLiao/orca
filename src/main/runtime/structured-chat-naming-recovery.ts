import { isDeepStrictEqual } from 'node:util'
import type { RuntimeStore } from './runtime-store-contract'
import type { StructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-host'
import { getStructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-registry'
import { resolveTextGenerationParams } from '../text-generation/commit-message-text-generation'
import { LOCAL_COMMIT_MESSAGE_HOST_KEY } from '../../shared/commit-message-host-key'

const installed = new WeakSet<StructuredAgentSessionHost>()

export function installStructuredChatNamingRecovery(
  store: Pick<RuntimeStore, 'getSettings' | 'onSettingsChanged'>,
  host: StructuredAgentSessionHost,
  recover: () => Promise<void>
): void {
  if (installed.has(host)) {
    return
  }
  installed.add(host)
  const configuration = () => {
    const settings = store.getSettings()
    return {
      enabled: settings.nativeChatAutoName !== false,
      generation: resolveTextGenerationParams(
        settings,
        LOCAL_COMMIT_MESSAGE_HOST_KEY,
        'conversationName'
      )
    }
  }
  let previous = configuration()
  const stop = store.onSettingsChanged?.(() => {
    if (getStructuredAgentSessionHost() !== host) {
      stop?.()
      return
    }
    const next = configuration()
    if (isDeepStrictEqual(previous, next)) {
      return
    }
    previous = next
    if (next.enabled) {
      void recover()
    }
  })
  if (previous.enabled) {
    void recover()
  }
}
