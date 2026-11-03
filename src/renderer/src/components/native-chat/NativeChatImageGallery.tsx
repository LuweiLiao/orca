import { useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import type { NativeChatMessage } from '../../../../shared/native-chat-types'
import { NativeChatMarkdownImage } from './NativeChatMarkdownImage'
import { NativeChatImageGalleryContext } from './native-chat-image-gallery-context'
import { NativeChatMarkdownImageOwnerContext } from './native-chat-markdown-image-owner'
import {
  nativeChatGalleryImageHref,
  nativeChatGalleryImages,
  nativeChatGallerySource
} from './native-chat-gallery-images'
import { nativeChatImageLabel } from './native-chat-image-label'
import { reportNativeChatImageDisplay } from './native-chat-image-display-report'

export function NativeChatImageGallery({
  messages,
  isVisible,
  children
}: {
  messages: readonly NativeChatMessage[]
  isVisible: boolean
  children: ReactNode
}): React.JSX.Element {
  const owner = useContext(NativeChatMarkdownImageOwnerContext)
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const [selection, setSelection] = useState<{ source: string; messageId?: string } | null>(null)
  const open = selection !== null && isVisible
  const images = useMemo(() => (open ? nativeChatGalleryImages(messages) : []), [messages, open])
  const index = selection
    ? images.findIndex(
        (image) =>
          image.source === selection.source &&
          (!selection.messageId || image.messageId === selection.messageId)
      )
    : -1
  const image = images[index]
  const openImage = useCallback((value: { source: string; messageId?: string }) => {
    const source = nativeChatGallerySource(value.source)
    const matches = nativeChatGalleryImages(messagesRef.current).filter(
      (image) => image.source === source
    )
    const match = matches.find((image) => image.messageId === value.messageId) ?? matches[0]
    if (!match) {
      return false
    }
    setSelection({ source, messageId: match.messageId })
    return true
  }, [])
  if (!isVisible && selection) {
    setSelection(null)
  }
  const move = (offset: number): void => {
    const next = images[index + offset]
    if (next) {
      setSelection({ source: next.source, messageId: next.messageId })
    }
  }
  return (
    <NativeChatImageGalleryContext.Provider value={openImage}>
      {children}
      {image ? (
        <NativeChatMarkdownImage
          src={nativeChatGalleryImageHref(image)}
          alt={
            image.block.alt || (image.block.path ? nativeChatImageLabel(image.block) : undefined)
          }
          dialog={{
            onOpenChange: (next) => {
              if (!next) {
                setSelection(null)
              }
            },
            navigation:
              images.length > 1
                ? {
                    hasPrevious: index > 0,
                    hasNext: index < images.length - 1,
                    onPrevious: () => move(-1),
                    onNext: () => move(1)
                  }
                : undefined,
            onImageLoad: () =>
              reportNativeChatImageDisplay(
                image.block,
                owner?.sessionId,
                owner?.runtimeContext?.target,
                'loaded'
              ),
            onImageError: () =>
              reportNativeChatImageDisplay(
                image.block,
                owner?.sessionId,
                owner?.runtimeContext?.target,
                'failed'
              )
          }}
        />
      ) : null}
    </NativeChatImageGalleryContext.Provider>
  )
}
