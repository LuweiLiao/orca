import type { ComponentProps, Ref } from 'react'
import { NATIVE_CHAT_TRANSCRIPT_COLUMN_CLASS } from './native-chat-appearance-style'
import {
  NativeChatTranscriptItems,
  NativeChatWaitingTranscriptItems
} from './NativeChatTranscriptItems'
import { NativeChatTurnActivityLine } from './NativeChatTurnActivityLine'
import { NativeChatAwaitingInputRow } from './NativeChatAwaitingInputRow'
import type { transcriptTailRow } from './native-chat-transcript-tail-row'

type ActivityProps = ComponentProps<typeof NativeChatTurnActivityLine>
export function NativeChatTranscriptContent({
  ref,
  liveLine,
  tailRow,
  waitingSlots,
  onLinkClick,
  allowFileUriLinks,
  ...rows
}: ComponentProps<typeof NativeChatTranscriptItems> & {
  ref: Ref<HTMLDivElement>
  liveLine: ActivityProps['line'] | null
  tailRow: ReturnType<typeof transcriptTailRow>
  waitingSlots: ComponentProps<typeof NativeChatWaitingTranscriptItems>['slots']
  onLinkClick: ActivityProps['onLinkClick']
  allowFileUriLinks: ActivityProps['allowFileUriLinks']
}) {
  return (
    <div
      ref={ref}
      data-native-chat-transcript-column
      className={NATIVE_CHAT_TRANSCRIPT_COLUMN_CLASS}
    >
      <NativeChatTranscriptItems {...rows} />
      {liveLine ? (
        <NativeChatTurnActivityLine
          line={liveLine}
          onLinkClick={onLinkClick}
          allowFileUriLinks={allowFileUriLinks}
        />
      ) : tailRow === 'awaiting-input' ? (
        <NativeChatAwaitingInputRow subject={null} pending />
      ) : null}
      <NativeChatWaitingTranscriptItems slots={waitingSlots} context={rows.context} />
    </div>
  )
}
