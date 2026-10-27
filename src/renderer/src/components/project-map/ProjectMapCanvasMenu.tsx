import { useState } from 'react'
import {
  BookMarked,
  Eye,
  EyeOff,
  GitFork,
  MessageSquareQuote,
  Pencil,
  Scan,
  Search,
  SquareArrowOutUpRight,
  SquareTerminal
} from 'lucide-react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuShortcut,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { referenceConversationInFocusedChat } from '@/components/native-chat/conversation-reference-insertion'
import { getShortcutPlatform } from '@/lib/shortcut-platform'
import type { ProjectMapCollapsedView } from './project-map-collapse'
import type { ProjectMapAgent, ProjectMapGraph } from './project-map-graph'
import {
  projectMapAgentActions,
  projectMapAgentHasTab,
  projectMapGroupActions,
  type ProjectMapActionBlock,
  type ProjectMapAgentActionId,
  type ProjectMapNodeAction
} from './project-map-node-actions'
import { projectMapNodeIdOf } from './project-map-node-target'
import { projectMapConversationReference } from './project-map-reference'

type Props = {
  graph: ProjectMapGraph
  collapsed: ProjectMapCollapsedView
  forkUnsupportedHosts: ReadonlySet<string>
  onOpenAgent: (agent: ProjectMapAgent) => void
  onNewChild: (paneKey: string) => void
  onRename: (paneKey: string) => void
  onFit: () => void
  onSearch: () => void
  /** The element the menu opens on: the canvas, whose nodes are found from the event target. */
  children: React.ReactElement
}

const stopPropagation = (event: React.SyntheticEvent): void => event.stopPropagation()

const AGENT_LABELS: Record<ProjectMapAgentActionId, () => string> = {
  'open-tab': () => translate('projectMap.menu.openTab', 'Open in tab'),
  'show-terminal': () => translate('projectMap.menu.showTerminal', 'Show in terminal'),
  reference: () => translate('projectMap.menu.reference', 'Reference in current chat'),
  'new-child': () => translate('projectMap.menu.newChild', 'New child conversation'),
  rename: () => translate('projectMap.menu.rename', 'Rename'),
  'mark-read': () => translate('projectMap.menu.markRead', 'Mark as read'),
  'mark-unread': () => translate('projectMap.menu.markUnread', 'Mark as unread')
}

const AGENT_ICONS: Record<ProjectMapAgentActionId, typeof Pencil> = {
  'open-tab': SquareArrowOutUpRight,
  'show-terminal': SquareTerminal,
  reference: MessageSquareQuote,
  'new-child': GitFork,
  rename: Pencil,
  'mark-read': Eye,
  'mark-unread': EyeOff
}

const REASONS: Record<ProjectMapActionBlock, () => string> = {
  'no-terminal': () =>
    translate('projectMap.menu.reason.noTerminal', 'No terminal behind this conversation'),
  'no-chat': () => translate('projectMap.menu.reason.noChat', 'Not a structured chat'),
  'remote-host': () =>
    translate('projectMap.menu.reason.remoteHost', 'Not available on SSH or WSL hosts'),
  'host-too-old': () =>
    translate('projectMap.menu.reason.hostTooOld', 'This host is too old to fork chats'),
  closed: () => translate('projectMap.menu.reason.closed', 'Closed: open it in a tab first'),
  'no-tab': () => translate('projectMap.menu.reason.noTab', 'Open it in a tab to rename it'),
  'not-finished': () =>
    translate('projectMap.menu.reason.notFinished', 'Only a finished conversation can be unread'),
  'all-read': () => translate('projectMap.menu.reason.allRead', 'Nothing unread')
}

function MenuItem({
  action,
  label,
  Icon,
  onSelect
}: {
  action: ProjectMapNodeAction<string>
  label: string
  Icon: typeof Pencil
  onSelect: () => void
}): React.JSX.Element {
  return (
    <ContextMenuItem
      disabled={!action.enabled}
      data-project-map-action={action.id}
      onSelect={onSelect}
    >
      <Icon />
      <span className="flex min-w-0 flex-col">
        <span>{label}</span>
        {action.reason ? (
          <span className="text-[11px] font-normal text-muted-foreground">
            {REASONS[action.reason]()}
          </span>
        ) : null}
      </span>
    </ContextMenuItem>
  )
}

/** The right-click menu of the map: a chat's actions, a stack's, or the canvas's own. */
export function ProjectMapCanvasMenu({
  graph,
  collapsed,
  forkUnsupportedHosts,
  onOpenAgent,
  onNewChild,
  onRename,
  onFit,
  onSearch,
  children
}: Props): React.JSX.Element {
  const unifiedTabs = useAppStore((s) => s.unifiedTabsByWorktree)
  const [targetId, setTargetId] = useState<string | null>(null)
  const agent = targetId ? graph.agents.get(targetId) : undefined
  const group = targetId ? collapsed.groups.get(targetId) : undefined
  const members = group
    ? group.memberPaneKeys.flatMap((paneKey) => graph.agents.get(paneKey) ?? [])
    : []
  const searchKeys = getShortcutPlatform() === 'darwin' ? '⌘F' : 'Ctrl+F'

  const runAgent = (chat: ProjectMapAgent, id: ProjectMapAgentActionId): void => {
    const store = useAppStore.getState()
    switch (id) {
      case 'open-tab':
      case 'show-terminal':
        return onOpenAgent(chat)
      case 'reference':
        return void referenceConversationInFocusedChat(projectMapConversationReference(chat))
      case 'new-child':
        return onNewChild(chat.card.paneKey)
      case 'rename':
        return onRename(chat.card.paneKey)
      case 'mark-read':
        return store.acknowledgeAgents([chat.card.paneKey], undefined, 'explicit')
      case 'mark-unread':
        return store.unacknowledgeAgents([chat.card.paneKey])
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger
        asChild
        onContextMenu={(event) => setTargetId(projectMapNodeIdOf(event.target))}
      >
        {children}
      </ContextMenuTrigger>
      {/* Why: portaled items still bubble through React to the canvas, which would deselect. */}
      <ContextMenuContent
        onClick={stopPropagation}
        onPointerDown={stopPropagation}
        onMouseDown={stopPropagation}
        onKeyDown={stopPropagation}
        onContextMenu={stopPropagation}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        {agent ? (
          projectMapAgentActions(agent, {
            hasTab: projectMapAgentHasTab(unifiedTabs, agent.card),
            hostTooOld: forkUnsupportedHosts.has(agent.chat?.executionHostId ?? '')
          }).map((action) => (
            <MenuItem
              key={action.id}
              action={action}
              label={AGENT_LABELS[action.id]()}
              Icon={AGENT_ICONS[action.id]}
              onSelect={() => runAgent(agent, action.id)}
            />
          ))
        ) : group ? (
          projectMapGroupActions(members).map((action) => (
            <MenuItem
              key={action.id}
              action={action}
              label={translate('projectMap.menu.markAllRead', 'Mark all as read')}
              Icon={BookMarked}
              onSelect={() =>
                useAppStore.getState().acknowledgeAgents(
                  members
                    .filter((member) => member.card.unseen)
                    .map((member) => member.card.paneKey),
                  undefined,
                  'explicit'
                )
              }
            />
          ))
        ) : (
          <>
            <ContextMenuItem data-project-map-action="fit" onSelect={onFit}>
              <Scan />
              {translate('projectMap.fit', 'Fit to view')}
            </ContextMenuItem>
            <ContextMenuItem data-project-map-action="search" onSelect={onSearch}>
              <Search />
              {translate('projectMap.menu.search', 'Search the map')}
              <ContextMenuShortcut>{searchKeys}</ContextMenuShortcut>
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
