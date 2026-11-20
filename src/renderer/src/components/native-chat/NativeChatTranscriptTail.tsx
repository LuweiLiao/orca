import type { ComponentProps } from 'react'
import { NativeChatAwaitingInputRow } from './prompts/NativeChatAwaitingInputRow'
import { NativeChatTurnActivityLine } from './messages/reasoning/NativeChatTurnActivityLine'
import type { transcriptTailRow } from './conversation/slots/native-chat-transcript-tail-row'

/** What ends a transcript while a turn runs: its live activity, or a pending question. */
export function NativeChatTranscriptTail({
  liveLine,
  tailRow
}: {
  liveLine: ComponentProps<typeof NativeChatTurnActivityLine>['line'] | null | undefined
  tailRow: ReturnType<typeof transcriptTailRow>
}): React.JSX.Element | null {
  if (liveLine) {
    return <NativeChatTurnActivityLine line={liveLine} />
  }
  return tailRow === 'awaiting-input' ? <NativeChatAwaitingInputRow subject={null} pending /> : null
}
