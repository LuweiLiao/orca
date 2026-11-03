import { useContext, type ReactNode } from 'react'
import type { NativeChatMessage } from '../../../../shared/native-chat-types'
import {
  NativeChatDisclosureContext,
  type NativeChatDisclosureStore
} from './native-chat-disclosure-store'
import { NativeChatImageGallery } from './NativeChatImageGallery'
import { NativeChatMarkdownImageOwnerContext } from './native-chat-markdown-image-owner'

export function NativeChatTranscriptProviders({
  disclosures,
  messages,
  isVisible,
  children
}: {
  disclosures: NativeChatDisclosureStore
  messages: readonly NativeChatMessage[]
  isVisible: boolean
  children: ReactNode
}): React.JSX.Element {
  const owner = useContext(NativeChatMarkdownImageOwnerContext)
  return (
    <NativeChatDisclosureContext.Provider value={disclosures}>
      <NativeChatImageGallery key={owner?.sessionId} messages={messages} isVisible={isVisible}>
        {children}
      </NativeChatImageGallery>
    </NativeChatDisclosureContext.Provider>
  )
}
