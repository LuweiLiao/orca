import { useState } from 'react'
import { translate } from '@/i18n/i18n'
import { readConversationReferenceDrag } from '@/lib/conversation-reference-drag'
import { structuredAgentSessionTargetForHost } from '@/runtime/native-chat/session-ownership/structured-agent-session-owner'
import {
  conversationReferenceToken,
  withConversationReferenceInstructions,
  type ConversationReference
} from '../../../../shared/conversation-reference'
import { toRuntimeExecutionHostId } from '../../../../shared/execution-host/execution-host'
import type { ExecutionHostId } from '../../../../shared/execution-host/execution-host'
import { carriesConversationReference } from './project-map-reference-drop'

/**
 * Other chats a new child should read too, dropped on its panel beside the one it continues. They
 * follow the typed text in the first instruction, with the usual reading instructions.
 */
export function useProjectMapForkReferences(
  hostId: ExecutionHostId | null | undefined,
  onError: (message: string | null) => void
) {
  const [references, setReferences] = useState<ConversationReference[]>([])
  const [dropping, setDropping] = useState(false)
  const target = structuredAgentSessionTargetForHost(hostId)

  const add = async (event: React.DragEvent<HTMLElement>): Promise<void> => {
    setDropping(false)
    const dropped = readConversationReferenceDrag(event.dataTransfer)
    if (!dropped) {
      return
    }
    event.preventDefault()
    // The child runs on the chat's host; it can read only references that host can reach.
    const environment = target?.kind === 'environment' ? target.environmentId : undefined
    if (environment && dropped.executionHostId !== toRuntimeExecutionHostId(environment)) {
      onError(
        translate(
          'components.native-chat.conversationReference.differentHost',
          'This agent cannot reach the conversation on its source host. Open the chat on that host to reference it.'
        )
      )
      return
    }
    try {
      const made = await window.api.aiVault.createConversationReference(dropped)
      setReferences((current) =>
        current.some((reference) => reference.uri === made.uri) ? current : [...current, made]
      )
    } catch (failure) {
      onError(failure instanceof Error ? failure.message : String(failure))
    }
  }

  return {
    references,
    dropping,
    remove: (uri: string) =>
      setReferences((current) => current.filter((reference) => reference.uri !== uri)),
    /** Typed text first so the child is named for it; references after, with how to read them. */
    firstInstruction: (instruction: string): string =>
      references.length === 0
        ? instruction
        : withConversationReferenceInstructions(
            [instruction.trim(), references.map(conversationReferenceToken).join(' ')]
              .filter(Boolean)
              .join('\n\n')
          ),
    panelProps: {
      'data-reference-drop': dropping || undefined,
      onDragOver: (event: React.DragEvent<HTMLElement>) => {
        if (carriesConversationReference(event)) {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
          setDropping(true)
        }
      },
      onDragLeave: (event: React.DragEvent<HTMLElement>) => {
        const next = event.relatedTarget
        if (!(next instanceof Node) || !event.currentTarget.contains(next)) {
          setDropping(false)
        }
      },
      onDrop: (event: React.DragEvent<HTMLElement>) => void add(event)
    }
  }
}
