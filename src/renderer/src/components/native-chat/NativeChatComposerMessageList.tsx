import type { ComponentProps } from 'react'
import { NativeChatMessageList } from './NativeChatMessageList'
import { NativeChatOrchestrationProposalProvider } from './NativeChatOrchestrationProposal'

export function NativeChatComposerMessageList({
  composerRef,
  ...props
}: Omit<ComponentProps<typeof NativeChatMessageList>, 'expandSignal'> & {
  composerRef: ComponentProps<typeof NativeChatOrchestrationProposalProvider>['composerRef']
}): React.JSX.Element {
  return (
    <NativeChatOrchestrationProposalProvider
      composerRef={composerRef}
      available={composerRef !== null}
    >
      <NativeChatMessageList {...props} expandSignal={false} />
    </NativeChatOrchestrationProposalProvider>
  )
}
