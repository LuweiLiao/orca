import { memo } from 'react'
import { Folder, GitBranch, Layers } from 'lucide-react'
import { AgentTypeIcon } from '@/components/agent/icons/agent-type-icon'
import { formatAgentTypeLabel } from '../../../../shared/agent-status/presentation/agent-type-label'
import { AgentStateDot } from '@/components/agent/status/AgentStateDot'
import { translate } from '@/i18n/i18n'
import { dashboardCardDisplayState } from '../../../../shared/agent-status/presentation/dashboard-snapshot'
import type { ProjectMapAgent, ProjectMapWorkspace } from './project-map-graph'
import { PROJECT_MAP_NODE, type ProjectMapNodeBox } from './project-map-layout'
import { projectMapAgentTitle, projectMapStateLabel } from './project-map-labels'
import type { ProjectMapGroup } from './project-map-collapse'

type PinKind = 'derive' | 'delegate' | 'unresolved'
type HeaderPinKind = 'fork' | 'unresolved'

type NodeShellProps = {
  box: ProjectMapNodeBox
  kind: 'workspace' | 'folder' | 'agent' | 'group'
  label: string
  selected: boolean
  linked: boolean
  onSelect: (id: string) => void
  header: React.ReactNode
  rowLeft: React.ReactNode
  rowRight?: React.ReactNode
  inPin?: PinKind
  outPin?: PinKind
  headerInPin?: HeaderPinKind
  headerOutPin?: HeaderPinKind
  /** A closed chat drawn because a fork still connects it. */
  history?: boolean
  /** Present when the canvas reveals something, like the + handle, while the pointer is here. */
  onHover?: (id: string | null) => void
  /** Corner marker: waiting on the person, or finished and not looked at yet. */
  badge?: { tone: 'attention' | 'unseen'; title: string }
}

function NodeShell({
  box,
  kind,
  label,
  selected,
  linked,
  onSelect,
  header,
  rowLeft,
  rowRight,
  inPin,
  outPin,
  headerInPin,
  headerOutPin,
  history,
  onHover,
  badge
}: NodeShellProps): React.JSX.Element {
  return (
    <button
      type="button"
      data-project-map-node={box.id}
      data-kind={kind}
      data-selected={selected}
      data-linked={linked}
      data-history={history || undefined}
      data-attention={badge?.tone === 'attention' || undefined}
      {...(onHover
        ? { onPointerEnter: () => onHover(box.id), onPointerLeave: () => onHover(null) }
        : {})}
      aria-pressed={selected}
      aria-label={label}
      // Why: the canvas pans on background presses; a node press is a selection.
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        onSelect(box.id)
      }}
      className="project-map-node absolute flex flex-col text-left text-foreground"
      style={{ left: box.x, top: box.y, width: box.width, height: PROJECT_MAP_NODE.height }}
    >
      {badge ? (
        <span className="project-map-node-badge" data-tone={badge.tone} title={badge.title} />
      ) : null}
      <span className="project-map-node-header relative flex h-10 w-full shrink-0 items-center gap-2 px-2.5">
        {headerInPin ? (
          <span
            aria-hidden
            className="project-map-fork-pin"
            data-side="in"
            data-wire={headerInPin}
          />
        ) : null}
        {header}
        {headerOutPin ? (
          <span
            aria-hidden
            className="project-map-fork-pin"
            data-side="out"
            data-wire={headerOutPin}
          />
        ) : null}
      </span>
      <span className="relative flex h-[26px] w-full items-center gap-1.5 px-3 text-[11px] text-muted-foreground">
        {inPin ? (
          <span aria-hidden className="project-map-pin" data-side="in" data-wire={inPin} />
        ) : null}
        <span className="min-w-0 truncate">{rowLeft}</span>
        {rowRight ? <span className="ml-auto shrink-0">{rowRight}</span> : null}
        {outPin ? (
          <span aria-hidden className="project-map-pin" data-side="out" data-wire={outPin} />
        ) : null}
      </span>
    </button>
  )
}

function HeaderText({ title, subtitle }: { title: string; subtitle: string }): React.JSX.Element {
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="truncate text-[13px] font-semibold leading-[17px]">{title}</span>
      <span className="truncate text-[11px] leading-[15px] text-muted-foreground">{subtitle}</span>
    </span>
  )
}

export const ProjectMapWorkspaceNode = memo(function ProjectMapWorkspaceNode({
  box,
  workspace,
  branch,
  current,
  selected,
  linked,
  onSelect
}: {
  box: ProjectMapNodeBox
  workspace: ProjectMapWorkspace
  branch: string | null
  current: boolean
  selected: boolean
  linked: boolean
  onSelect: (id: string) => void
}): React.JSX.Element {
  const folder = workspace.workspaceKind === 'folder'
  const Glyph = folder ? Folder : GitBranch
  const count = workspace.agentPaneKeys.length
  const subtitle = [
    translate('projectMap.node.conversationCount', '{{count}} conversations', { count }),
    current ? translate('projectMap.node.current', 'Current') : null
  ]
    .filter(Boolean)
    .join(' · ')
  const rowLeft = folder
    ? translate('projectMap.node.folderWorkspace', 'Folder workspace')
    : workspace.parentId
      ? translate('projectMap.node.derivedFrom', 'Derived')
      : (branch ?? translate('projectMap.node.root', 'Root'))
  return (
    <NodeShell
      box={box}
      kind={folder ? 'folder' : 'workspace'}
      label={workspace.worktreeName}
      selected={selected}
      linked={linked}
      onSelect={onSelect}
      header={
        <>
          <Glyph aria-hidden className="project-map-node-glyph size-3.5 shrink-0" />
          <HeaderText title={workspace.worktreeName} subtitle={subtitle} />
        </>
      }
      rowLeft={
        <span className={branch && !workspace.parentId ? 'font-mono' : undefined}>{rowLeft}</span>
      }
      inPin={workspace.parentId ? 'derive' : undefined}
      outPin={workspace.childIds.length > 0 ? 'derive' : undefined}
    />
  )
})

export const ProjectMapAgentNode = memo(function ProjectMapAgentNode({
  box,
  agent,
  graphAgents,
  onHover,
  selected,
  linked,
  onSelect
}: {
  box: ProjectMapNodeBox
  agent: ProjectMapAgent
  graphAgents: ReadonlyMap<string, ProjectMapAgent>
  onHover?: (id: string | null) => void
  selected: boolean
  linked: boolean
  onSelect: (id: string) => void
}): React.JSX.Element {
  const { card } = agent
  const state = dashboardCardDisplayState(card)
  const title = projectMapAgentTitle(card)
  const subagentCount = card.subagents?.length ?? 0
  const forkChildren = forkChildCount(agent, graphAgents)
  const delegates = agent.childPaneKeys.length - forkChildren
  const rowLeft = agent.sourceHidden ? (
    translate('projectMap.node.sourceNotLoaded', 'Source not loaded')
  ) : agent.fork ? (
    <span className="project-map-fork-source">{forkSourceLabel(agent.fork)}</span>
  ) : agent.parentPaneKey ? (
    translate('projectMap.node.delegatedFrom', 'Delegated')
  ) : agent.hasUnresolvedParent ? (
    translate('projectMap.node.sourceNotLoaded', 'Source not loaded')
  ) : (
    projectMapStateLabel(state)
  )
  const rowRight =
    subagentCount > 0
      ? translate('projectMap.node.subagentCount', '{{count}} subagents', { count: subagentCount })
      : forkChildren > 0
        ? translate('projectMap.node.forkCount', '{{count}} forks', { count: forkChildren })
        : delegates > 0
          ? translate('projectMap.node.delegateCount', 'Delegates {{count}}', { count: delegates })
          : undefined
  const badge = agent.history ? undefined : agentBadge(card, state)
  return (
    <NodeShell
      box={box}
      kind="agent"
      label={title}
      selected={selected}
      linked={linked}
      onSelect={onSelect}
      header={
        <>
          <span className="inline-flex shrink-0">
            <AgentTypeIcon agentType={card.agentType} size={14} />
          </span>
          <HeaderText
            title={title}
            subtitle={`${formatAgentTypeLabel(card.agentType)} · ${
              agent.history
                ? translate('projectMap.node.closed', 'Closed')
                : projectMapStateLabel(state)
            }`}
          />
          {agent.history ? null : <AgentStateDot state={state} title={null} />}
        </>
      }
      rowLeft={rowLeft}
      rowRight={rowRight}
      history={agent.history}
      {...(badge ? { badge } : {})}
      {...(onHover ? { onHover } : {})}
      inPin={
        agent.fork
          ? undefined
          : agent.parentPaneKey
            ? 'delegate'
            : agent.hasUnresolvedParent
              ? 'unresolved'
              : undefined
      }
      outPin={delegates > 0 ? 'delegate' : undefined}
      headerInPin={agent.fork ? (agent.parentPaneKey ? 'fork' : 'unresolved') : undefined}
      headerOutPin={forkChildren > 0 ? 'fork' : undefined}
    />
  )
})

function forkChildCount(
  agent: ProjectMapAgent,
  agents: ReadonlyMap<string, ProjectMapAgent>
): number {
  return agent.childPaneKeys.filter((paneKey) => agents.get(paneKey)?.fork).length
}

function forkSourceLabel(fork: NonNullable<ProjectMapAgent['fork']>): string {
  return translate('projectMap.node.forkedFrom', 'Forked from {{source}}', {
    source: fork.sourceTitle ?? translate('projectMap.node.closedSource', 'a closed chat')
  })
}

/** Stands in for a busy parent's delegated chats until the person opens them. */
export const ProjectMapGroupNode = memo(function ProjectMapGroupNode({
  box,
  group,
  forksOut,
  selected,
  linked,
  onSelect
}: {
  box: ProjectMapNodeBox
  group: ProjectMapGroup
  /** A hidden chat was forked; the fork wire leaves from the stack. */
  forksOut: boolean
  selected: boolean
  linked: boolean
  onSelect: (id: string) => void
}): React.JSX.Element {
  const count = group.childPaneKeys.length
  const nested = group.memberPaneKeys.length - count
  const title = translate('projectMap.group.title', '{{count}} delegated chats', { count })
  const { working, waiting, settled } = group.counts
  return (
    <NodeShell
      box={box}
      kind="group"
      label={title}
      selected={selected}
      linked={linked}
      onSelect={onSelect}
      header={
        <>
          <Layers aria-hidden className="project-map-node-glyph size-3.5 shrink-0" />
          <HeaderText
            title={title}
            subtitle={
              nested > 0
                ? translate('projectMap.group.nested', 'and {{count}} they delegated', {
                    count: nested
                  })
                : translate('projectMap.group.open', 'Click to list them')
            }
          />
        </>
      }
      rowLeft={
        <span className="inline-flex items-center gap-2.5 tabular-nums">
          <GroupCount state="working" count={working} />
          <GroupCount state="waiting" count={waiting} />
          <GroupCount state="idle" count={settled} />
        </span>
      }
      inPin="delegate"
      headerOutPin={forksOut ? 'fork' : undefined}
    />
  )
})

function GroupCount({
  state,
  count
}: {
  state: 'working' | 'waiting' | 'idle'
  count: number
}): React.JSX.Element | null {
  if (count === 0) {
    return null
  }
  return (
    <span
      className="inline-flex items-center gap-1"
      data-project-map-group-count={state}
      title={projectMapStateLabel(state)}
    >
      <AgentStateDot state={state} title={null} />
      {count}
    </span>
  )
}

function agentBadge(
  card: ProjectMapAgent['card'],
  state: ReturnType<typeof dashboardCardDisplayState>
): NodeShellProps['badge'] {
  if (state === 'blocked' || state === 'waiting') {
    return {
      tone: 'attention',
      title: card.askSummary || translate('projectMap.node.needsInput', 'Waiting for you')
    }
  }
  return card.unseen && state === 'done'
    ? { tone: 'unseen', title: translate('projectMap.node.unseen', 'Finished, not read yet') }
    : undefined
}
