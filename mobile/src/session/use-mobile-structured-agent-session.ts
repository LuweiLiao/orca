import { useCallback, useMemo, useRef } from 'react'
import { encodeNativeChatTranscriptIdentity } from '../../../src/shared/native-chat-transcript-retention'
import { projectStructuredAgentSessionMessages } from '../../../src/shared/structured-agent-session-message-projection'
import {
  projectStructuredQuestionMessages,
  structuredQuestionTranscript
} from '../../../src/shared/structured-agent-question-projection'
import { withNativeChatCutTurnNotices } from '../../../src/shared/native-chat-cut-turn-notice'
import { agentSessionTranscriptRows } from '../../../src/shared/agent-session-context-clear'
import { tuiAgentDisplayName } from '../../../src/shared/tui-agent-display-names'
import { mobileStructuredAgentSessionWorking } from './mobile-structured-agent-session-working'
import { useMobileNativeChatQueueFollowUps } from './use-mobile-native-chat-queue-follow-ups'
import { isFinalAgentSessionReadRefusal } from '../../../src/shared/structured-agent-session-read-refusal'
import {
  isStructuredAgentSessionThinking,
  runningStructuredAgentSessionTurnId
} from '../../../src/shared/structured-agent-session-live-turn'
import { selectStructuredAgentTurnActivity } from '../../../src/shared/native-chat-turn-activity'
import {
  actionableStructuredApproval,
  actionableStructuredQuestion
} from './mobile-structured-actionable-prompt'
import {
  projectStructuredPermission,
  projectStructuredQuestion
} from './mobile-structured-agent-prompts'
import type {
  MobileStructuredAgentSessionArgs,
  StructuredMobileSession
} from './mobile-structured-agent-session-contract'
import type { MobileNativeChatVisualSource } from './mobile-native-chat-visual-read'
import { useMobileStructuredAgentState } from './use-mobile-structured-agent-state'
import { useMobileStructuredStopPress } from './use-mobile-structured-stop-press'
import { useMobileStructuredSessionHostStopping } from './use-mobile-structured-session-host-stopping'
import { useMobileStructuredPromptResponses } from './use-mobile-structured-prompt-responses'
import { useMobileStructuredAgentOptions } from './use-mobile-structured-agent-options'
import { useMobileStructuredSessionOptionStamp } from './use-mobile-structured-session-option-stamp'
import { useMobileStructuredAgentTurnTiming } from './use-mobile-structured-agent-turn-timing'
import {
  pendingStructuredPromptIdentity,
  requestMobileStructuredAgentSessionCancel
} from './mobile-structured-agent-session-cancel'
import { useMobileStructuredAgentMutate } from './use-mobile-structured-agent-mutation'
import { agentStopDisplayStatus } from '../../../src/shared/agent-stop-display-status'
import {
  mobileStructuredSendQueues,
  mobileStructuredSendFollowUp,
  useMobileStructuredSendWithOutcome
} from './use-mobile-structured-send-with-outcome'
import { useMobileStructuredQueuedMessageControls } from './use-mobile-structured-queued-message-controls'
import { useMobileStructuredBackgroundTasks } from './use-mobile-structured-background-tasks'
import { useMobileStructuredSends } from './use-mobile-structured-sends'

export function useMobileStructuredAgentSession(
  args: MobileStructuredAgentSessionArgs
): StructuredMobileSession {
  const {
    agent,
    appendComposerText,
    client,
    connected,
    sessionId,
    sourceIdentity = '',
    enabled,
    onActionResolved,
    onSendError,
    hostSupport
  } = args
  // Only a host that queues sends gets the delivery field; any host's published cards show.
  const queueCapable = hostSupport?.queuedMessages === true
  const queueFollowUps = useMobileNativeChatQueueFollowUps(client, connected, sessionId)
  // A /compact waits in line only where its card renders.
  const promptCancelSupported = hostSupport?.promptCancel ?? null
  const hostAnswersRepeatedStops = hostSupport?.quietRepeatedStop ?? null
  const hostStopsConversation = hostSupport?.conversationStop ?? null
  const sessionKey = encodeNativeChatTranscriptIdentity([sourceIdentity, agent, sessionId])
  const commandPendingRef = useRef(false)
  // Against a host that predates the quiet repeated Stop, a Stop of a turn still being stopped joins it.
  const inFlightStopsRef = useRef(new Map<string, Promise<boolean>>())
  const stateArgs = { client, sessionId, sessionKey, enabled, connected }
  const { state, stateRef, queuedMessages, queuePause, olderPages, loadEarlier } =
    useMobileStructuredAgentState(stateArgs)

  const mutate = useMobileStructuredAgentMutate({
    client,
    sessionId,
    enabled,
    stateRef,
    onSendError,
    ...(agent ? { agentName: tuiAgentDisplayName(agent) ?? agent } : {})
  })

  const optionStamp = useMobileStructuredSessionOptionStamp({
    client,
    sessionId,
    enabled: enabled && connected && hostSupport?.statusFeed === true
  })
  const options = useMobileStructuredAgentOptions({
    agent,
    client,
    sessionId,
    enabled,
    fence: state.fence,
    mutate,
    optionStamp,
    hostSupport
  })
  const { conversationCommands, invokeStructuredOption, optionSnapshot, setStructuredOption } =
    options
  // Stable across renders, or the send callback is rebuilt on every streamed frame.
  const sendController = useMemo(
    () => ({
      snapshot: optionSnapshot,
      setOption: setStructuredOption,
      invokeAction: invokeStructuredOption,
      conversationCommands
    }),
    [conversationCommands, invokeStructuredOption, optionSnapshot, setStructuredOption]
  )

  const { groupedDraft, respondPermission, respondQuestion } = useMobileStructuredPromptResponses({
    stateRef,
    sessionKey,
    mutate,
    questionAnswersSupported: hostSupport?.questionAnswers ?? null,
    onSendError
  })

  // What the transcript reads, as desktop does: the journal since the latest /clear, plus the one
  // notice a cut turn with no row gets.
  const transcriptItems = useMemo(
    () =>
      withNativeChatCutTurnNotices(agentSessionTranscriptRows(state.items), {
        agentName: agent ? (tuiAgentDisplayName(agent) ?? agent) : undefined
      }),
    [agent, state.items]
  )
  const sends = useMobileStructuredSends({
    sessionKey,
    cursor: state.cursor,
    submissions: state.submissions,
    queuedMessages,
    onSendError
  })
  const messages = useMemo(
    // A message the host recorded and then rejected stays where it was sent, as not sent.
    () =>
      projectStructuredAgentSessionMessages(
        transcriptItems,
        sends.optimistic,
        state.submissions,
        projectStructuredQuestionMessages
      ),
    [transcriptItems, sends.optimistic, state.submissions]
  )
  const turnId = runningStructuredAgentSessionTurnId(state)
  const turnTiming = useMobileStructuredAgentTurnTiming(
    { ...state, items: transcriptItems },
    turnId
  )
  const activityText =
    selectStructuredAgentTurnActivity(state.items, turnId, state.activity)?.text ?? null
  const thinking = isStructuredAgentSessionThinking(state)
  // The host's answer counts only the agent running now; an older host gives none.
  const isWorking = mobileStructuredAgentSessionWorking(state)
  const backgroundTasks = useMobileStructuredBackgroundTasks({
    sessionKey,
    state,
    turnId,
    connected,
    mutate
  })
  const hostStopping = useMobileStructuredSessionHostStopping({
    client,
    sessionId,
    enabled: enabled && connected && hostSupport?.statusFeed === true
  })
  // The host's word, bridged by this phone's own press until its Stop event lands.
  const stopPress = useMobileStructuredStopPress(sessionKey)
  const stopping =
    agentStopDisplayStatus({
      working: isWorking,
      hostStopping,
      stopPressed: stopPress.pressed
    }) === 'stopping'
  const stopRequestInFlight = isWorking && stopPress.pressed
  const sendWithOutcome = useMobileStructuredSendWithOutcome({
    agent,
    client,
    sessionId,
    enabled,
    queueCapable,
    queueFollowUps,
    commandsWait: queueCapable && hostSupport?.queuedCommands === true,
    stateRef,
    stopping,
    accept: sends.accept,
    hold: sends.hold,
    commandPending: commandPendingRef,
    controller: sendController,
    onSendError,
    sendOptions: hostSupport?.sendOptions === true ? options.sendSelection : undefined
  })
  const turnIndicator = useMemo(
    () => ({
      thinking,
      activityText,
      stopping,
      stopRequestInFlight,
      ...(stopping
        ? {
            afterStop: mobileStructuredSendQueues(queueCapable, queueFollowUps, state)
              ? ('queue' as const)
              : ('send' as const)
          }
        : {})
    }),
    [thinking, activityText, stopping, stopRequestInFlight, queueCapable, queueFollowUps, state]
  )
  const { items, currentRequests, actionablePromptIds, status } = state
  // The host's answer where it gives one: a prompt an agent that ended raised takes no answer.
  const [approvalPrompt, questionPrompt] = useMemo(() => {
    const prompts = { items, currentRequests, actionablePromptIds }
    return [actionableStructuredApproval(prompts), actionableStructuredQuestion(prompts)] as const
  }, [items, currentRequests, actionablePromptIds])
  // What a refused command's line on the phone stands on.
  const commandRefusalCauses = useMemo(
    () => ({
      working: turnId !== null,
      prompt: approvalPrompt !== null || questionPrompt !== null
    }),
    [approvalPrompt, questionPrompt, turnId]
  )
  const queued = useMobileStructuredQueuedMessageControls({
    sessionKey,
    agentName: agent ? (tuiAgentDisplayName(agent) ?? agent) : undefined,
    journalItems: state.items,
    queuedMessages,
    queuePause,
    submissions: state.submissions,
    agentWorking: isWorking,
    client,
    sessionId,
    editCapable: hostSupport ? hostSupport.queuedMessageEdit === true : null,
    chatActive: enabled,
    enabled: enabled && connected,
    mutate,
    appendComposerText,
    onSendError,
    ...(onActionResolved ? { onActionResolved } : {})
  })
  // Stop leaves the queue on the host until the user's next action.
  const requestCancel = useCallback(
    (prompt?: { itemId: string; expectedRevision: number }): Promise<boolean> =>
      requestMobileStructuredAgentSessionCancel({
        client,
        enabled,
        hostAnswersRepeatedStops,
        hostStopsConversation,
        inFlight: inFlightStopsRef.current,
        onSendError,
        prompt,
        promptCancelSupported,
        sessionId,
        stateRef
      }),
    [
      client,
      enabled,
      hostAnswersRepeatedStops,
      hostStopsConversation,
      onSendError,
      promptCancelSupported,
      sessionId,
      stateRef
    ]
  )

  const visualSource = useMemo<MobileNativeChatVisualSource | null>(
    () => (client && sessionId ? { client, sessionId } : null),
    [client, sessionId]
  )

  return {
    ...options,
    visualSource,
    imagePreviewsByMessageId: sends.imagePreviewsByMessageId,
    session: {
      messages,
      status,
      transcriptLoading: status === 'loading',
      error: state.error,
      readFailedFinally: status === 'error' && isFinalAgentSessionReadRefusal(state.readRefusal),
      // History that can never be read from here ends paging; its line says so.
      hasMore: state.hasOlder && olderPages !== 'unavailable',
      loadingEarlier: olderPages === 'loading',
      olderPages,
      loadEarlier
    },
    isWorking,
    canStop: turnId !== null || (hostStopsConversation === true && isWorking),
    sendFollowUp: mobileStructuredSendFollowUp(queueCapable, queueFollowUps, state, stopping),
    turnId,
    turnIndicator,
    ...turnTiming,
    sendWithOutcome,
    cancel: () => void stopPress.track(() => requestCancel()),
    cancelPrompt: (prompt?: { itemId: string; expectedRevision: number }) =>
      requestCancel(prompt ?? pendingStructuredPromptIdentity(stateRef.current)),
    receipts: structuredQuestionTranscript(transcriptItems).receipts,
    actionablePromptIds: state.actionablePromptIds,
    permission: projectStructuredPermission(approvalPrompt),
    question: projectStructuredQuestion(questionPrompt, groupedDraft),
    respondPermission,
    respondQuestion,
    queued,
    commandRefusalCauses,
    backgroundTasks
  }
}
