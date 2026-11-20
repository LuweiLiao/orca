import type { ComponentProps, ReactNode } from 'react'
import { nativeChatTranscriptOuterClass } from '../appearance/native-chat-appearance-style'
import { NativeChatTranscriptViewport } from '../NativeChatTranscriptViewport'
import { NativeChatMessageRail } from '../viewport/rail/NativeChatMessageRail'
import { NativeChatNewRowsAnnouncement } from '../viewport/new-rows/NativeChatNewRowsMarker'
import { NativeChatConversationFrame } from './NativeChatConversationFrame'

type FrameProps = Omit<ComponentProps<typeof NativeChatConversationFrame>, 'children'>
type RailProps = ComponentProps<typeof NativeChatMessageRail>

/** The conversation's scroller with its rail, or with the Skill/MCP and timeline sidebar in its place. */
export function NativeChatConversationViewport({
  frame,
  viewport,
  railRef,
  onRailWheel,
  newRowsMarked,
  olderHistory,
  children
}: {
  frame: FrameProps
  viewport: Omit<
    ComponentProps<typeof NativeChatTranscriptViewport>,
    'overlays' | 'children' | 'scrollRef'
  > & { scrollRef: RailProps['scrollRef'] }
  railRef: RailProps['railRef']
  onRailWheel: RailProps['onReaderScroll']
  newRowsMarked: boolean
  /** Drawn above the transcript column, inside the scroller. */
  olderHistory: ReactNode
  children: ReactNode
}): React.JSX.Element {
  const { rail } = frame
  return (
    <NativeChatConversationFrame {...frame}>
      {(sidebarOpen) => (
        <NativeChatTranscriptViewport
          {...viewport}
          overlays={
            <>
              {sidebarOpen ? null : (
                <NativeChatMessageRail
                  rail={rail}
                  railRef={railRef}
                  scrollRef={viewport.scrollRef}
                  onSelect={frame.onSelect}
                  onReaderScroll={onRailWheel}
                  pendingId={frame.pendingId}
                />
              )}
              <NativeChatNewRowsAnnouncement marked={newRowsMarked} />
            </>
          }
        >
          {olderHistory}
          <div className={nativeChatTranscriptOuterClass(!sidebarOpen && rail.visible)}>
            {children}
          </div>
        </NativeChatTranscriptViewport>
      )}
    </NativeChatConversationFrame>
  )
}
