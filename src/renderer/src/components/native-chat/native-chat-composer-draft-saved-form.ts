import { basename } from '@/lib/path'
import { isNativeChatKeptPastePath, isNativeChatPastedImagePath } from './native-chat-image-paste'
import { isAgentSessionAttachmentStorePath } from '../../../../shared/agent-session-attachments'
import type { DraftRecord } from './native-chat-composer-draft-memory'
import type {
  NativeChatComposerDraftImage,
  StoredNativeChatComposerDraft
} from './native-chat-composer-draft-storage'

export function unavailableNativeChatComposerDraftImage(
  image: NativeChatComposerDraftImage
): NativeChatComposerDraftImage {
  return image.unavailableName === undefined
    ? { id: image.id, path: '', unavailableName: basename(image.path) }
    : image
}

export function isKeptLocalPaste(image: NativeChatComposerDraftImage): boolean {
  return !image.connectionId && isNativeChatKeptPastePath(image.path)
}

/** External paste paths restore as placeholders; host-owned and locally kept attachments survive. */
export function savedNativeChatComposerDraft(
  record: DraftRecord
): StoredNativeChatComposerDraft | null {
  const { unsavedText, ...saved } = record
  const images = saved.images.map((image) =>
    isNativeChatPastedImagePath(image.path) &&
    !isKeptLocalPaste(image) &&
    !isAgentSessionAttachmentStorePath(image.path)
      ? unavailableNativeChatComposerDraftImage(image)
      : image
  )
  const text = saved.text === unsavedText ? '' : saved.text
  return text === '' && images.length === 0 ? null : { ...saved, text, images }
}
