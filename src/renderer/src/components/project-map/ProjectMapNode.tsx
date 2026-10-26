import { memo } from 'react'
import { Folder, GitBranch } from 'lucide-react'
import { AgentTypeIcon } from '@/lib/agent-type-icon'
import { formatAgentTypeLabel } from '@/lib/agent-status'
import { AgentStateDot } from '@/components/AgentStateDot'
import { translate } from '@/i18n/i18n'
import { dashboardCardDisplayState } from '../../../../shared/dashboard-snapshot'
import type { ProjectMapAgent, ProjectMapWorkspace } from './project-map-graph'
import { PROJECT_MAP_NODE, type ProjectMapNodeBox } from './project-map-layout'
import { projectMapAgentTitle, projectMapStateLabel } from './project-map-labels'

type PinKind = 'derive' | 'delegate' | 'unresolved'

type NodeShellProps = {
  box: ProjectMapNodeBox
  kind: 'workspace' | 'folder' | 'agent'
  label: string
  selected: boolean
  linked: boolean
  onSelect: (id: string) => void
  header: React.ReactNode
  rowLeft: React.ReactNode
  rowRight?: React.ReactNode
  inPin?: PinKind
  outPin?: PinKind
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
  outPin
}: NodeShellProps): React.JSX.Element {
  return (
    <button
      type="button"
      data-project-map-node={box.id}
      data-kind={kind}
      data-selected={selected}
      data-linked={linked}
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
      <span className="project-map-node-header flex h-10 w-full shrink-0 items-center gap-2 px-2.5">
        {header}
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
  selected,
  linked,
  onSelect
}: {
  box: ProjectMapNodeBox
  agent: ProjectMapAgent
  selected: boolean
  linked: boolean
  onSelect: (id: string) => void
}): React.JSX.Element {
  const { card } = agent
  const state = dashboardCardDisplayState(card)
  const title = projectMapAgentTitle(card)
  const subagentCount = card.subagents?.length ?? 0
  const rowLeft = agent.parentPaneKey
    ? translate('projectMap.node.delegatedFrom', 'Delegated')
    : agent.hasUnresolvedParent
      ? translate('projectMap.node.sourceNotLoaded', 'Source not loaded')
      : projectMapStateLabel(state)
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
            subtitle={`${formatAgentTypeLabel(card.agentType)} · ${projectMapStateLabel(state)}`}
          />
          <AgentStateDot state={state} title={null} />
        </>
      }
      rowLeft={rowLeft}
      rowRight={
        subagentCount > 0
          ? translate('projectMap.node.subagentCount', '{{count}} subagents', {
              count: subagentCount
            })
          : agent.childPaneKeys.length > 0
            ? translate('projectMap.node.delegateCount', 'Delegates {{count}}', {
                count: agent.childPaneKeys.length
              })
            : undefined
      }
      inPin={
        agent.parentPaneKey ? 'delegate' : agent.hasUnresolvedParent ? 'unresolved' : undefined
      }
      outPin={agent.childPaneKeys.length > 0 ? 'delegate' : undefined}
    />
  )
})
