import { useState } from 'react'
import { readConversationReferenceDrag } from '@/lib/conversation-reference-drag'
import type { ConversationReferenceCreate } from '../../../../shared/conversation-reference'
import { carriesConversationReference } from './project-map-reference-drop'

type DropHandlers = {
  onDragOver: (event: React.DragEvent<HTMLButtonElement>) => void
  onDragLeave: () => void
  onDrop: (event: React.DragEvent<HTMLButtonElement>) => void
}

/** Drop handlers for a node that takes a dragged conversation as a reference, and whether one hovers. */
export function useProjectMapNodeReferenceDrop(
  onReferenceDrop: ((source: ConversationReferenceCreate) => void) | undefined
): { dropping: boolean; handlers: Partial<DropHandlers> } {
  const [dropping, setDropping] = useState(false)
  if (!onReferenceDrop) {
    return { dropping: false, handlers: {} }
  }
  return {
    dropping,
    handlers: {
      onDragOver: (event) => {
        if (carriesConversationReference(event)) {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
          setDropping(true)
        }
      },
      onDragLeave: () => setDropping(false),
      onDrop: (event) => {
        setDropping(false)
        const source = readConversationReferenceDrag(event.dataTransfer)
        if (source) {
          event.preventDefault()
          event.stopPropagation()
          onReferenceDrop(source)
        }
      }
    }
  }
}
