import { getAgentLabel } from '@/lib/agent-catalog'
import { withConversationReferenceInstructions } from '../../../../shared/conversation-reference'
import { formatAgentTypeLabel } from '../../../../shared/agent-type-label'
import { isTuiAgent } from '../../../../shared/tui-agent-config'
import { MAX_SKILL_REFS } from '../../../../shared/rpc-contract/structured-agent-session-message-params'
import { SkillRefLimitError } from '../../../../shared/structured-agent-session-send-mutation'
import { promptSkillRefs } from './native-chat-prompt-document'
import { promptOrchestrationCards } from './native-chat-prompt-orchestration-cards'
import { withNativeChatTextDelegation } from './native-chat-text-delegation-store'
import { useCallback } from 'react'
import { prepareNativeChatAnnotatedMessage } from './native-chat-annotations-store'
import { completeNativeChatStructuredUserAction } from './native-chat-structured-user-action'
import {
  isStructuredAgentSessionHostCommand,
  structuredAgentSessionCommandChangesConversation
} from '../../../../shared/structured-agent-session-composer'
import type { AgentType } from '../../../../shared/agent-status-types'
import { dispatchNativeChatStructuredComposerText } from './native-chat-structured-composer-dispatch'
import type {
  NativeChatComposerSendIntent,
  NativeChatStructuredComposerTransport
} from './native-chat-composer-types'
import type { NativeChatComposerImageAttachment } from './NativeChatComposerField'
import { nativeChatAttachImagesAgainReason } from './native-chat-image-reattach'
import { nativeChatNoticeFromError } from './native-chat-composer-notice'
import { agentSessionWriteNoticeText } from './agent-session-write-notice-text'
import { translate } from '@/i18n/i18n'
import {
  readNativeChatComposerDraft,
  updateNativeChatComposerDraft
} from './native-chat-composer-draft-store'
import { nativeChatComposerDraftLeftAfterSend } from './native-chat-composer-draft-comparison'
import {
  admitNativeChatPastedText,
  resolveNativeChatPastedText
} from './native-chat-composer-pasted-text-references'

export type UseNativeChatStructuredComposerSendArgs = {
  agent: AgentType
  draftScopeKey: string
  annotationScopeKey?: string
  imageAttachments: readonly NativeChatComposerImageAttachment[]
  structuredTransport?: NativeChatStructuredComposerTransport
  isComposing: () => boolean
  clearSkillOrigin: () => void
  setDraft: (value: string) => void
  setCaret: (caret: number) => void
}

export type NativeChatStructuredComposerSend = (
  text: string,
  attachments?: readonly NativeChatComposerImageAttachment[],
  intent?: NativeChatComposerSendIntent
) => Promise<void>

/** Send through the structured journal transport, clearing the composer only
 *  once the transport accepts (the PTY path has its own sibling hook). */
export function useNativeChatStructuredComposerSend({
  agent,
  draftScopeKey,
  annotationScopeKey,
  imageAttachments,
  structuredTransport,
  isComposing,
  clearSkillOrigin,
  setDraft,
  setCaret
}: UseNativeChatStructuredComposerSendArgs): NativeChatStructuredComposerSend {
  return useCallback<NativeChatStructuredComposerSend>(
    async (text, attachments = imageAttachments, intent): Promise<void> => {
      // Picked commands must also wait for pending attachments to acquire paths.
      if (!structuredTransport || attachments.some((attachment) => attachment.pending)) {
        return
      }
      if (!admitNativeChatPastedText(draftScopeKey, text, structuredTransport.onError)) {
        return
      }
      const typed = text
      text = resolveNativeChatPastedText(draftScopeKey, text)
      const hostCommand = isStructuredAgentSessionHostCommand(
        text,
        structuredTransport.threadGoal !== undefined
      )
      // Blocked hosts cannot take turns/conversation commands; option commands only configure later turns.
      if (
        structuredTransport.sendBlockedReason !== undefined &&
        (!hostCommand || structuredAgentSessionCommandChangesConversation(text))
      ) {
        return
      }
      // A command picked while images await re-attaching would send them without a file.
      const attachAgain = nativeChatAttachImagesAgainReason(attachments)
      if (attachAgain) {
        structuredTransport.onError(attachAgain)
        return
      }
      if (attachments.length > 0 && hostCommand) {
        structuredTransport.onError(
          translate(
            'components.native-chat.composer.commandAttachmentsUnsupported',
            'Remove attachments before using a chat-session command.'
          )
        )
        return
      }
      // A conversation command reveals at the press, not after its round trip; options move nothing.
      if (hostCommand && structuredAgentSessionCommandChangesConversation(text)) {
        structuredTransport.onSubmitted?.()
      }
      const isCurrent = structuredTransport.capturePresentation()
      const submitted = readNativeChatComposerDraft(draftScopeKey)
      const pills = promptOrchestrationCards(submitted.document)
      const message = hostCommand
        ? { text, cards: pills }
        : withNativeChatTextDelegation(draftScopeKey, typed, { text, cards: pills })
      const annotated = hostCommand
        ? null
        : prepareNativeChatAnnotatedMessage(annotationScopeKey, message.text)
      let annotationMessageId: string | undefined
      await dispatchNativeChatStructuredComposerText(
        structuredTransport,
        withConversationReferenceInstructions(annotated?.text ?? message.text),
        attachments,
        promptSkillRefs(submitted.document),
        message.cards,
        annotated?.hasAnnotations
          ? {
              ...intent,
              onAdmitted: (messageId) => {
                annotationMessageId = messageId
                annotated.reserve(messageId)
              },
              onSettled: (outcome) => {
                if (annotationMessageId && (outcome === 'returned' || outcome === 'dropped')) {
                  annotated.release(annotationMessageId)
                }
              }
            }
          : intent
      )
        .then(({ accepted, error, refusedWhile, revealsTranscript }) => {
          if (!hostCommand || isCurrent()) {
            structuredTransport.onError(error, refusedWhile ? { refusedWhile } : undefined)
          }
          if (!accepted) {
            return
          }
          completeNativeChatStructuredUserAction(
            agent,
            structuredTransport,
            revealsTranscript && (!hostCommand || isCurrent())
          )
          // Why: the send settles after a round trip, while this or another composer of the same
          // conversation may have changed the draft; only what was sent leaves it.
          const left = nativeChatComposerDraftLeftAfterSend(
            readNativeChatComposerDraft(draftScopeKey),
            submitted
          )
          if (!left) {
            return
          }
          if (hostCommand && !isCurrent()) {
            updateNativeChatComposerDraft(
              draftScopeKey,
              { text: left.text, document: undefined, images: left.images },
              'immediate'
            )
            return
          }
          updateNativeChatComposerDraft(draftScopeKey, { images: left.images }, 'immediate')
          // A live composition owns the field, which keeps only what it composed once cleared.
          const composing = isComposing()
          setDraft(composing ? '' : left.text)
          setCaret(composing ? 0 : left.text.length)
          clearSkillOrigin()
        })
        .catch((error) => {
          if (hostCommand && !isCurrent()) {
            return
          }
          const notice = nativeChatNoticeFromError(
            error,
            error instanceof SkillRefLimitError
              ? translate(
                  'components.native-chat.composer.tooManySkills',
                  'Your message was not sent to {{agent}}. Keep at most {{limit}} selected skill files and try again.',
                  {
                    agent: isTuiAgent(agent) ? getAgentLabel(agent) : formatAgentTypeLabel(agent),
                    limit: MAX_SKILL_REFS
                  }
                )
              : agentSessionWriteNoticeText([hostCommand ? 'notDoneCommand' : 'notDoneSend'])
          )
          structuredTransport.onError(notice.text, { errorText: notice.errorText })
        })
    },
    [
      agent,
      annotationScopeKey,
      clearSkillOrigin,
      draftScopeKey,
      imageAttachments,
      isComposing,
      setCaret,
      setDraft,
      structuredTransport
    ]
  )
}
