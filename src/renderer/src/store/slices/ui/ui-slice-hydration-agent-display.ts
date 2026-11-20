import type { PersistedUIState } from '../../../../../shared/orca-profiles/persisted-ui-state-types'
import { normalizeAgentActivityDisplayMode } from '../../../../../shared/agent-status/presentation/agent-activity-display-mode'
import { normalizeWorktreeAgentOrder } from '../../../../../shared/agent-status/presentation/worktree-agent-order'

export function hydrateAgentDisplayFields(ui: PersistedUIState) {
  return {
    showAgentModels: ui.showAgentModels !== false,
    agentActivityDisplayMode: normalizeAgentActivityDisplayMode(ui.agentActivityDisplayMode),
    worktreeAgentOrder: normalizeWorktreeAgentOrder(ui.worktreeAgentOrder)
  }
}
