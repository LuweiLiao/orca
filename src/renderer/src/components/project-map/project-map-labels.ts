import { formatAgentTypeLabel } from '@/lib/agent-status'
import { translate } from '@/i18n/i18n'
import type {
  DashboardCard,
  DashboardCardDisplayState
} from '../../../../shared/dashboard-snapshot'

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
  }
}

export function projectMapAgentTitle(
  card: Pick<DashboardCard, 'conversationName' | 'task' | 'agentType'>
): string {
  return card.conversationName || card.task || formatAgentTypeLabel(card.agentType)
}
