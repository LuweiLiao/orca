import { createContext } from 'react'

export const NativeChatImageGalleryContext = createContext<
  ((image: { source: string; messageId?: string }) => boolean) | null
>(null)
