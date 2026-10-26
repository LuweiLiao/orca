import { formatAgentTypeLabel } from '../../../../shared/agent-status/presentation/agent-type-label'
import { translate } from '@/i18n/i18n'
import type {
  DashboardCard,
  DashboardCardDisplayState
} from '../../../../shared/agent-status/presentation/dashboard-snapshot'

export function projectMapStateLabel(state: DashboardCardDisplayState): string {
  switch (state) {
    case 'working':
      return translate('projectMap.state.working', 'Working')
    case 'monitoring':
      return translate('projectMap.state.monitoring', 'Monitoring')
    case 'blocked':
      return translate('projectMap.state.blocked', 'Blocked')
    case 'waiting':
      return translate('projectMap.state.waiting', 'Waiting for input')
    case 'done':
      return translate('projectMap.state.done', 'Done')
    case 'idle':
      return translate('projectMap.state.idle', 'Idle')
    case 'failed':
      return translate('projectMap.state.failed', 'Failed')
    case 'interrupted':
      return translate('projectMap.state.interrupted', 'Interrupted')
    case 'unconfirmed':
      return translate('projectMap.state.unconfirmed', 'Unconfirmed')
  }
}

export function projectMapAgentTitle(
  card: Pick<DashboardCard, 'conversationName' | 'task' | 'agentType'>
): string {
  return card.conversationName || card.task || formatAgentTypeLabel(card.agentType)
}
