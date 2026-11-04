import type { ComponentProps, RefObject } from 'react'
import type { NativeChatComposerHandle } from './native-chat-composer-types'
import { NativeChatComposerMessageList } from './NativeChatComposerMessageList'
import type { useStructuredAgentSession } from './use-structured-agent-session'
import type { NativeChatStructuredViewProps } from './native-chat-view-types'
import { useChatCapabilityControls } from './use-chat-capability-controls'

const NO_COMPOSER = { current: null }
type MessageListProps = ComponentProps<typeof NativeChatComposerMessageList>
export function NativeChatStructuredTranscript({
  controller,
  view,
  ...props
}: Pick<
  MessageListProps,
  | 'ref'
  | 'session'
  | 'emptyState'
  | 'awaitingInput'
  | 'onLinkClick'
  | 'allowFileUriLinks'
  | 'runtimeContext'
  | 'deliveryNotices'
  | 'stopping'
> & {
  controller: ReturnType<typeof useStructuredAgentSession>
  composerRef: RefObject<NativeChatComposerHandle | null> | null
  view: Pick<NativeChatStructuredViewProps, 'agent' | 'tabId' | 'isVisible'>
}) {
  const controls = useChatCapabilityControls(
    view,
    controller,
    props.composerRef ?? NO_COMPOSER,
    props.composerRef !== null
  )
  return (
    <NativeChatComposerMessageList
      {...props}
      capabilityControls={controls}
      journalItems={controller.journalItems}
      journalSubmissions={controller.submissions}
      journalLatestTurn={controller.latestTurn}
      journalHostWork={controller.hostWork}
      subagentRoster={controller.subagentRoster}
      railOutline={controller.railOutline}
      isVisible={view.isVisible}
      isWorking={controller.isWorking}
      workingStartedAt={controller.workingStartedAt}
      settledTurns={controller.settledTurns}
      turnActivity={controller.turnActivity}
    />
  )
}
