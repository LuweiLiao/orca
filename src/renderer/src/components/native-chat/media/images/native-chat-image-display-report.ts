import type { NativeChatImageRefBlock } from '../../../../../../shared/native-chat/native-chat-types'
import type { RuntimeClientTarget } from '../../../../../../shared/remote-runtime/host-catalog/runtime-client-target'
import { callStructuredAgentSession } from '@/runtime/native-chat/requests/structured-agent-session-call'

export function reportNativeChatImageDisplay(
  block: NativeChatImageRefBlock,
  sessionId: string | null | undefined,
  target: RuntimeClientTarget | undefined,
  state: 'loaded' | 'failed'
): void {
  if (
    !block.display ||
    block.display.state === state ||
    block.display.state === 'loaded' ||
    !sessionId ||
    !target
  ) {
    return
  }
  void callStructuredAgentSession(target, 'agentSession.imageRendered', {
    sessionId,
    id: block.display.id,
    state
  }).catch(() => {})
}
