import type { RefObject } from 'react'
import { useAppStore } from '../../../store/index'
import type { NativeChatComposerHandle } from '../composer/native-chat-composer-types'
import {
  formatNativeChatQuote,
  readNativeChatQuotableSelection
} from '../../../../../shared/native-chat/input/quotes/native-chat-quote-selection'
import { readNativeChatTranscriptSelection } from './native-chat-transcript-selection'
import { SelectionAddToChatPopover } from './SelectionAddToChatPopover'
import {
  readNativeChatAnnotationAnchor,
  type NativeChatAnnotationAnchor
} from '../annotations/native-chat-annotation-anchor'
import { nativeChatAnnotationCopy } from '../annotations/native-chat-annotation-copy'

function copyTranscriptSelectionOnSelect(root: HTMLElement): void {
  if (!useAppStore.getState().settings?.terminalClipboardOnSelect) {
    return
  }
  const text = readNativeChatTranscriptSelection(root)
  if (text) {
    // Swallowed like the terminal's copy on select: a failed copy leaves the selection to retry.
    void window.api.ui.writeClipboardText(text).catch(() => {})
  }
}

export function NativeChatSelectionQuote({
  rootRef,
  composerRef,
  enabled,
  onAnnotate
}: {
  rootRef: RefObject<HTMLElement | null>
  composerRef: RefObject<NativeChatComposerHandle | null>
  enabled: boolean
  /** Present where this chat keeps annotations; a selection can then be noted without the composer. */
  onAnnotate?: (anchor: NativeChatAnnotationAnchor) => void
}): React.JSX.Element {
  return (
    <SelectionAddToChatPopover
      rootRef={rootRef}
      enabled={enabled}
      readQuotable={(root) =>
        onAnnotate || composerRef.current?.acceptsText()
          ? readNativeChatQuotableSelection(root)
          : null
      }
      addDisabled={() => !composerRef.current?.acceptsText()}
      annotate={
        onAnnotate
          ? {
              label: nativeChatAnnotationCopy().add,
              onAnnotate: (range) => {
                const root = rootRef.current
                const anchor = root ? readNativeChatAnnotationAnchor(root, range) : null
                if (anchor) {
                  onAnnotate(anchor)
                }
              }
            }
          : undefined
      }
      onSelectionSettled={copyTranscriptSelectionOnSelect}
      onAdd={(text) => composerRef.current?.appendText(formatNativeChatQuote(text))}
    />
  )
}
