import type { NativeChatImageRefBlock } from '../../../../shared/native-chat-types'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import { callStructuredAgentSession } from '@/runtime/structured-agent-session-client'

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
