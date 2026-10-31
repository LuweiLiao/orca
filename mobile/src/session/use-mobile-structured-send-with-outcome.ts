import { selectAgentSessionCurrentRequests } from '../../../src/shared/agent-session-current-requests'
// The structured composer's one send seam: a slash command dispatches as a
// conversation command, and everything else goes out as an
// `agentSession.send` — carrying `delivery: 'queue-if-active'` only when the
// host advertises the queue and no pending prompt is one this build cannot answer.

import { useCallback } from 'react'
import { runningStructuredAgentSessionTurnId } from '../../../src/shared/structured-agent-session-live-turn'
import { mobileStructuredAgentSessionWorking } from './mobile-structured-agent-session-working'
import { nativeChatSendFollowUp } from '../../../src/shared/native-chat-follow-up-behavior'
import { pendingPromptsAllUnanswerableHere } from '../../../src/shared/agent-session-approval-subject'
import {
  structuredAgentSessionSendBody,
  type StructuredAgentSessionAttachment
} from '../../../src/shared/structured-agent-session-send-mutation'
import type { StructuredAgentSessionComposerOptions } from '../../../src/shared/structured-agent-session-composer'
import type { StructuredAgentSessionState } from '../../../src/shared/structured-agent-session-reducer'
import {
  structuredAgentSessionFollowUpsQueue,
  structuredAgentSessionQueueEnabled
} from '../../../src/shared/structured-agent-session-queued-cards'
import type { RpcClient } from '../transport/rpc-client'
import type {
  MobileNativeChatSendIntent,
  MobileNativeChatSendOutcome
} from './mobile-native-chat-send'
import { dispatchMobileStructuredCommand } from './mobile-structured-composer-command'
import type { MobileNativeChatSendErrorReporter } from './use-mobile-native-chat-send-error'
import { sendMobileStructuredAgentSessionMessage } from './mobile-structured-agent-session-send'
import type { MobileStructuredSends } from './use-mobile-structured-sends'
import { structuredSessionOperationId } from './structured-session-operation-id'
import { timeoutForDeadline } from './mobile-structured-agent-session-rpc'
import { nativeChatTextWithFileReferences } from './mobile-native-chat-file-attachment'
import {
  actionableStructuredApproval,
  actionableStructuredQuestion
} from './mobile-structured-actionable-prompt'

/** The desktop's rule: the alternate flips the setting first, then the queue's own rules decide. */
export function mobileStructuredSendQueues(
  queueCapable: boolean,
  queueFollowUps: boolean,
  state: Pick<StructuredAgentSessionState, 'items' | 'currentRequests' | 'queuedMessages'>,
  send: { alternate?: boolean; isWorking: boolean; stopping: boolean } = {
    isWorking: false,
    stopping: false
  }
): boolean {
  return (
    queueCapable &&
    structuredAgentSessionQueueEnabled(
      structuredAgentSessionFollowUpsQueue(queueFollowUps, send),
      state,
      selectAgentSessionCurrentRequests(state)
    )
  )
}

/** What rides a send: an image the agent is shown, or a file it reads from a reference the send
 *  writes after the text, as desktop sends one. */
export type StructuredMobileSendAttachment =
  | (StructuredAgentSessionAttachment & { kind?: 'image'; id?: string })
  | { kind: 'file'; id?: string; path: string }

export function mobileStructuredSendFollowUp(
  queueCapable: boolean,
  queueFollowUps: boolean,
  state: StructuredAgentSessionState,
  stopping: boolean
) {
  const isWorking = mobileStructuredAgentSessionWorking(state)
  return queueCapable && isWorking && !stopping
    ? nativeChatSendFollowUp((alternate) =>
        mobileStructuredSendQueues(queueCapable, queueFollowUps, state, {
          alternate,
          isWorking,
          stopping
        })
      )
    : null
}

export function useMobileStructuredSendWithOutcome(args: {
  agent: string | null
  client: RpcClient | null
  sessionId: string | null
  enabled: boolean
  queueCapable: boolean
  queueFollowUps: boolean
  /** The host holds a /compact sent while the agent works as a card. */
  commandsWait: boolean
  stateRef: { readonly current: StructuredAgentSessionState }
  /** The chat reads Stopping: a send made now is drawn after the turn being stopped. */
  stopping: boolean
  accept: MobileStructuredSends['accept']
  hold: MobileStructuredSends['hold']
  commandPending: { current: boolean }
  controller: Pick<
    StructuredAgentSessionComposerOptions,
    'snapshot' | 'setOption' | 'invokeAction' | 'conversationCommands'
  >
  onSendError: MobileNativeChatSendErrorReporter
  /** The chat's own model and effort each send carries; absent for an older host, which takes neither. */
  sendOptions?: () => Readonly<Record<string, string>> | undefined
}): (
  text: string,
  images?: string[],
  deadline?: number,
  attachments?: readonly StructuredMobileSendAttachment[],
  intent?: MobileNativeChatSendIntent
) => Promise<MobileNativeChatSendOutcome> {
  const {
    accept,
    agent,
    client,
    commandPending,
    commandsWait,
    controller,
    enabled,
    hold,
    onSendError,
    queueCapable,
    queueFollowUps,
    sendOptions,
    sessionId,
    stateRef,
    stopping
  } = args
  return useCallback(
    async (
      text: string,
      images?: string[],
      deadline?: number,
      attachments?: readonly StructuredMobileSendAttachment[],
      intent?: MobileNativeChatSendIntent
    ): Promise<MobileNativeChatSendOutcome> => {
      const currentFence = stateRef.current.fence
      if (!client || !sessionId || !enabled || currentFence === null) {
        onSendError('Message not sent (disconnected)')
        return 'rejected'
      }
      const timeoutMs = timeoutForDeadline(deadline)
      if (timeoutMs === null) {
        onSendError('Message not sent')
        return 'rejected'
      }
      if (attachments === undefined && images !== undefined && images.length > 0) {
        onSendError('Message not sent')
        return 'rejected'
      }
      const sendAttachments = attachments ?? []
      const commandOutcome = await dispatchMobileStructuredCommand({
        text,
        hasAttachments: Boolean(sendAttachments.length || images?.length),
        client,
        sessionId,
        fence: currentFence,
        pending: commandPending,
        controller: { agent: agent ?? undefined, ...controller },
        busy: () =>
          actionableStructuredApproval(stateRef.current) ||
          actionableStructuredQuestion(stateRef.current)
            ? 'prompt'
            : runningStructuredAgentSessionTurnId(stateRef.current)
              ? 'working'
              : null,
        // A card waiting on a prompt nothing here can answer would hold it forever.
        waitsInLine: (command) =>
          command === 'compact' &&
          commandsWait &&
          !pendingPromptsAllUnanswerableHere(selectAgentSessionCurrentRequests(stateRef.current)),
        onError: onSendError,
        timeoutMs
      })
      if (commandOutcome !== null) {
        return commandOutcome
      }
      const imageAttachments: StructuredAgentSessionAttachment[] = []
      const files: { path: string }[] = []
      for (const attachment of sendAttachments) {
        if (attachment.kind === 'file') {
          files.push(attachment)
        } else {
          imageAttachments.push(attachment)
        }
      }
      const wireText = nativeChatTextWithFileReferences(text, files)
      const body = structuredAgentSessionSendBody(wireText, imageAttachments)
      if (body.blocks.length === 0) {
        return 'rejected'
      }
      // The host records it under this id, which is what settles it.
      const send = {
        clientMessageId: structuredSessionOperationId(),
        body,
        queuedAt: Date.now(),
        ...(stopping ? { sentWhileStopping: true as const } : {})
      }
      // A pick on its way holds the send, so the chat's values are what it holds.
      const options = sendOptions?.()
      const outcome = await sendMobileStructuredAgentSessionMessage({
        client,
        sessionId,
        expectedRuntimeFence: currentFence,
        text: wireText,
        attachments: imageAttachments,
        // Resolved from the chat as it is now: a hold-menu choice made mid-turn may land after it.
        ...(mobileStructuredSendQueues(queueCapable, queueFollowUps, stateRef.current, {
          alternate: intent?.alternate,
          isWorking: mobileStructuredAgentSessionWorking(stateRef.current),
          stopping
        })
          ? { delivery: 'queue-if-active' as const }
          : {}),
        ...(options ? { options } : {}),
        deadline,
        clientMessageId: send.clientMessageId,
        onAccepted: (cursor) =>
          accept({ ...send, ...(cursor ? { recordedCursor: cursor } : {}) }, images),
        onError: onSendError
      })
      if (outcome === 'unknown') {
        hold(send)
      }
      return outcome
    },
    [
      accept,
      agent,
      client,
      commandPending,
      commandsWait,
      controller,
      enabled,
      hold,
      onSendError,
      queueCapable,
      queueFollowUps,
      sendOptions,
      sessionId,
      stateRef,
      stopping
    ]
  )
}
