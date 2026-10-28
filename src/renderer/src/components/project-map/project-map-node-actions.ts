import type { Tab } from '../../../../shared/tab-types'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import { findRenamableUnifiedTab } from '@/store/terminals/renamable-unified-tab'
import type { ProjectMapAgent, ProjectMapEdge } from './project-map-graph'
import { projectMapConversationReference } from './project-map-reference'
import { projectMapAgentForkable } from './project-map-window-subject'
import { projectMapHideKey } from './project-map-hidden-filter'
import { projectMapSummaryBlock } from './project-map-summary'

export type ProjectMapAgentActionId =
  | 'open-tab'
  | 'show-terminal'
  | 'reference'
  | 'new-child'
  | 'rename'
  | 'mark-read'
  | 'mark-unread'
  | 'move-up'
  | 'move-down'
  | 'close'
  | 'hide'
  | 'hide-tree'
  | 'remove-from-map'
  | 'summary'
  | 'stop'

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
  | 'row-edge'
  | 'summary-host-too-old'
  | 'remote-worker'
  | 'host-unreachable'
  | 'stop-host-too-old'

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
  /** Which way the chat can change rows within its lane; absent when the map cannot move it. */
  rowMoves?: { up: boolean; down: boolean }
  /** The chat's host predates summaries. */
  summaryHostTooOld?: boolean
  /** Present when the node is running and can be stopped; `block` says why not right now. */
  stop?: { block: ProjectMapActionBlock | null }
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
    available('summary', projectMapSummaryBlock(agent, context.summaryHostTooOld === true)),
    available('new-child', forkBlock(agent, context)),
    // Names live on tabs: a closed chat or a background worker has none to write to.
    available('rename', !agent.history && context.hasTab ? null : 'no-tab'),
    ...(toggleRead ? [toggleRead] : []),
    ...(context.rowMoves
      ? [
          available('move-up', context.rowMoves.up ? null : 'row-edge'),
          available('move-down', context.rowMoves.down ? null : 'row-edge')
        ]
      : []),
    ...closeAndHideActions(agent, context),
    ...(context.stop ? [available('stop', context.stop.block)] : [])
  ]
}

function closeAndHideActions(
  agent: ProjectMapAgent,
  context: ProjectMapAgentActionContext
): ProjectMapNodeAction[] {
  if (agent.history) {
    return [{ id: 'remove-from-map', enabled: true }]
  }
  return [
    // A background worker has no tab to close; hiding is all it offers.
    ...(context.hasTab ? [{ id: 'close' as const, enabled: true }] : []),
    { id: 'hide', enabled: true },
    ...(agent.childPaneKeys.length > 0 ? [{ id: 'hide-tree' as const, enabled: true }] : [])
  ]
}

/** What closing a chat stops: a terminal agent's process, or a chat still working. */
export type ProjectMapCloseConfirmation = 'terminal' | 'running'

export function projectMapCloseConfirmation(
  agent: ProjectMapAgent
): ProjectMapCloseConfirmation | null {
  if (!agent.chat) {
    return 'terminal'
  }
  const { dotState } = agent.card
  return dotState === 'working' || dotState === 'blocked' || dotState === 'waiting'
    ? 'running'
    : null
}

/** A closed chat can be opened again from its record; a closed terminal's process cannot. */
export function projectMapCloseUndoable(agent: ProjectMapAgent): boolean {
  return agent.chat !== undefined
}

/** The hide keys of a node, with everything handed off or delegated beneath it when asked. */
export function projectMapHideKeysOf(
  agents: ReadonlyMap<string, ProjectMapAgent>,
  paneKey: string,
  withSubtree: boolean
): string[] {
  const keys: string[] = []
  const seen = new Set<string>()
  const visit = (key: string): void => {
    const agent = agents.get(key)
    if (!agent || seen.has(key)) {
      return
    }
    seen.add(key)
    keys.push(projectMapHideKey(agent))
    if (withSubtree) {
      agent.childPaneKeys.forEach(visit)
    }
  }
  visit(paneKey)
  return keys
}

/** A closed chat a wire still ends at stays drawn after its record goes, unless it is hidden. */
export function projectMapHistoryIsWired(
  edges: readonly ProjectMapEdge[],
  paneKey: string
): boolean {
  return edges.some((edge) => edge.from === paneKey || edge.to === paneKey)
}

export type ProjectMapGroupActionId = 'mark-read'

/** A stack offers only reading its hidden chats: everything else belongs to a chat inside it. */
export function projectMapGroupActions(
  members: readonly ProjectMapAgent[]
): ProjectMapNodeAction<ProjectMapGroupActionId>[] {
  return [available('mark-read', members.some((member) => member.card.unseen) ? null : 'all-read')]
}
