import { useStructuredAgentSessionDeliveryNotices } from './use-structured-agent-session-delivery-notices'
import { dispatchWasWithdrawn } from '../../../../../../../shared/agent-session/requests/structured-agent-session-dispatch-rejection'
import { useStructuredAgentSessionStartFailureFacts } from '../../../messages/notices/use-structured-agent-session-start-failure-facts'

type FailureNoticeInput = Parameters<typeof useStructuredAgentSessionDeliveryNotices>[0]

/** A chat's start failures and the delivery notices they explain, read only when something failed. */
export function useStructuredAgentSessionFailureNotices(
  controller: Omit<FailureNoticeInput, 'startFailures' | 'agentName'>,
  queuedCards: readonly { state: 'waiting' | 'returned' }[],
  agent: string,
  agentLabel: string
): {
  startFailures: ReturnType<typeof useStructuredAgentSessionStartFailureFacts>
  deliveryNotices: ReturnType<typeof useStructuredAgentSessionDeliveryNotices>
} {
  const needsFailureFacts =
    queuedCards.some((card) => card.state === 'returned') ||
    controller.submissions.some(
      (submission) => submission.dispatchState === 'rejected' && !dispatchWasWithdrawn(submission)
    )
  const startFailures = useStructuredAgentSessionStartFailureFacts(
    controller.journalItems,
    needsFailureFacts || agent === 'claude'
  )
  const deliveryNotices = useStructuredAgentSessionDeliveryNotices({
    pending: controller.pending,
    submissions: controller.submissions,
    journalItems: controller.journalItems,
    startFailures,
    agentName: agentLabel
  })
  return { startFailures, deliveryNotices }
}
