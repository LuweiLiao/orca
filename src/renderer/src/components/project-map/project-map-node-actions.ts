import type { Tab } from '../../../../shared/tab-types'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import { findRenamableUnifiedTab } from '@/store/terminals/renamable-unified-tab'
import type { ProjectMapAgent } from './project-map-graph'
import { projectMapConversationReference } from './project-map-reference'
import { projectMapAgentForkable } from './project-map-window-subject'

export type ProjectMapAgentActionId =
  | 'open-tab'
  | 'show-terminal'
  | 'reference'
  | 'new-child'
  | 'rename'
  | 'mark-read'
  | 'mark-unread'

/** Why an action is greyed out; the menu words each one. */
export type ProjectMapActionBlock =
  | 'no-terminal'
  | 'no-chat'
  | 'remote-host'
  | 'host-too-old'
  | 'closed'
  | 'no-tab'
  | 'not-finished'
  | 'all-read'

export type ProjectMapNodeAction<Id extends string = ProjectMapAgentActionId> = {
  id: Id
  enabled: boolean
  reason?: ProjectMapActionBlock
}

export type ProjectMapAgentActionContext = {
  /** The chat has a tab a title can be written to. */
  hasTab: boolean
  /** The chat's host is known to predate forks. */
  hostTooOld: boolean
}

/** A chat's tab, if one is open: terminals by their pty tab, structured chats by their own id. */
export function projectMapAgentHasTab(
  unifiedTabsByWorktree: Record<string, Tab[]>,
  card: Pick<DashboardCard, 'tabId'>
): boolean {
  return findRenamableUnifiedTab(unifiedTabsByWorktree, card.tabId) !== undefined
}

function available<Id extends string>(
  id: Id,
  reason: ProjectMapActionBlock | null
): ProjectMapNodeAction<Id> {
  return reason ? { id, enabled: false, reason } : { id, enabled: true }
}

function forkBlock(
  agent: ProjectMapAgent,
  context: ProjectMapAgentActionContext
): ProjectMapActionBlock | null {
  if (agent.history) {
    return 'closed'
  }
  if (!agent.chat) {
    return 'no-chat'
  }
  if (!projectMapAgentForkable(agent)) {
    return 'remote-host'
  }
  return context.hostTooOld ? 'host-too-old' : null
}

function readAction(agent: ProjectMapAgent): ProjectMapNodeAction | null {
  if (agent.history) {
    return null
  }
  if (agent.card.unseen) {
    return { id: 'mark-read', enabled: true }
  }
  return available('mark-unread', agent.card.dotState === 'done' ? null : 'not-finished')
}

/** What the right-click menu offers one chat node, and why an item is unavailable. */
export function projectMapAgentActions(
  agent: ProjectMapAgent,
  context: ProjectMapAgentActionContext
): ProjectMapNodeAction[] {
  const toggleRead = readAction(agent)
  return [
    { id: 'open-tab', enabled: true },
    available('show-terminal', agent.card.ptyId && !agent.history ? null : 'no-terminal'),
    available('reference', projectMapConversationReference(agent) ? null : 'no-chat'),
    available('new-child', forkBlock(agent, context)),
    // Names live on tabs: a closed chat or a background worker has none to write to.
    available('rename', !agent.history && context.hasTab ? null : 'no-tab'),
    ...(toggleRead ? [toggleRead] : [])
  ]
}

export type ProjectMapGroupActionId = 'mark-read'

/** A stack offers only reading its hidden chats: everything else belongs to a chat inside it. */
export function projectMapGroupActions(
  members: readonly ProjectMapAgent[]
): ProjectMapNodeAction<ProjectMapGroupActionId>[] {
  return [available('mark-read', members.some((member) => member.card.unseen) ? null : 'all-read')]
}
