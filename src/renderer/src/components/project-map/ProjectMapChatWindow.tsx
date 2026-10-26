import { useCallback, useState } from 'react'
import { Folder, GitBranch, GitFork, Maximize2, MessageSquarePlus, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AgentTypeIcon } from '@/lib/agent-type-icon'
import { formatAgentTypeLabel } from '@/lib/agent-status'
import { AgentStateDot } from '@/components/AgentStateDot'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { dashboardCardDisplayState } from '../../../../shared/dashboard-snapshot'
import type { ProjectMapAgent, ProjectMapWorkspace } from './project-map-graph'
import { projectMapAgentTitle, projectMapStateLabel } from './project-map-labels'
import { ProjectMapConversation } from './ProjectMapConversation'
import { placeProjectMapWindow, type ProjectMapRect } from './project-map-window-placement'

export type ProjectMapWindowSubject =
  | { kind: 'agent'; agent: ProjectMapAgent }
  | { kind: 'workspace'; workspace: ProjectMapWorkspace; agents: ProjectMapAgent[] }

type Props = {
  subject: ProjectMapWindowSubject
  /** The clicked node in viewport coordinates, used for the first placement. */
  anchor: ProjectMapRect
  viewport: { width: number; height: number }
  /** Nodes the window should avoid covering, in viewport coordinates. */
  avoid: ProjectMapRect[]
  onClose: () => void
  onOpenAgent: (agent: ProjectMapAgent) => void
  onOpenWorkspace: (workspace: ProjectMapWorkspace) => void
  /** Present when this chat can seed a child chat. */
  onFork?: () => void
}

const DEFAULT_SIZE = { width: 480, height: 640 }

export function ProjectMapChatWindow({
  subject,
  anchor,
  viewport,
  avoid,
  onClose,
  onOpenAgent,
  onOpenWorkspace,
  onFork
}: Props): React.JSX.Element {
  // Placed once per mount; the canvas keys this window by node, so opening another node re-anchors.
  const [position, setPosition] = useState(() =>
    placeProjectMapWindow(anchor, DEFAULT_SIZE, viewport, avoid)
  )
  const [activeTab, setActiveTab] = useState<string | null>(null)

  const startDrag = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (
        event.button !== 0 ||
        (event.target instanceof Element && event.target.closest('button'))
      ) {
        return
      }
      const header = event.currentTarget
      const origin = { x: event.clientX - position.x, y: event.clientY - position.y }
      header.setPointerCapture(event.pointerId)
      const move = (next: PointerEvent): void =>
        setPosition((current) => ({
          ...current,
          x: next.clientX - origin.x,
          y: Math.max(0, next.clientY - origin.y)
        }))
      const end = (): void => {
        header.removeEventListener('pointermove', move)
        header.removeEventListener('pointerup', end)
        header.removeEventListener('pointercancel', end)
      }
      header.addEventListener('pointermove', move)
      header.addEventListener('pointerup', end)
      header.addEventListener('pointercancel', end)
    },
    [position.x, position.y]
  )

  const workspaceAgents = subject.kind === 'workspace' ? subject.agents : []
  const tabAgent =
    subject.kind === 'agent'
      ? subject.agent
      : (workspaceAgents.find((agent) => agent.card.paneKey === activeTab) ?? workspaceAgents[0])
  const kind =
    subject.kind === 'agent'
      ? 'agent'
      : subject.workspace.workspaceKind === 'folder'
        ? 'folder'
        : 'workspace'

  return (
    <section
      role="dialog"
      aria-label={
        subject.kind === 'agent'
          ? projectMapAgentTitle(subject.agent.card)
          : subject.workspace.worktreeName
      }
      data-kind={kind}
      data-project-map-window=""
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      className="project-map-window absolute z-20 flex min-h-[320px] min-w-[360px] resize flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground"
      style={{
        left: position.x,
        top: position.y,
        width: DEFAULT_SIZE.width,
        height: Math.min(DEFAULT_SIZE.height, viewport.height - 16)
      }}
    >
      <header
        onPointerDown={startDrag}
        className="project-map-window-header flex h-12 shrink-0 cursor-grab items-center gap-2 border-b border-border pr-1.5 pl-3 select-none active:cursor-grabbing"
      >
        {subject.kind === 'agent' ? (
          <AgentHeader agent={subject.agent} />
        ) : (
          <WorkspaceHeader workspace={subject.workspace} />
        )}
        {onFork ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={translate('projectMap.fork.title', 'New child chat')}
            title={translate('projectMap.fork.title', 'New child chat')}
            onClick={onFork}
          >
            <GitFork className="size-3.5" />
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={translate('projectMap.window.openInTab', 'Open in tab')}
          title={translate('projectMap.window.openInTab', 'Open in tab')}
          onClick={() => {
            if (tabAgent) {
              onOpenAgent(tabAgent)
            } else if (subject.kind === 'workspace') {
              onOpenWorkspace(subject.workspace)
            }
          }}
        >
          <Maximize2 className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={translate('projectMap.window.close', 'Close')}
          onClick={onClose}
        >
          <XIcon className="size-3.5" />
        </Button>
      </header>
      {subject.kind === 'workspace' && workspaceAgents.length > 0 ? (
        <div
          role="tablist"
          className="flex shrink-0 gap-0.5 overflow-x-auto border-b border-border px-2 pt-1.5 scrollbar-none"
        >
          {workspaceAgents.map((agent) => {
            const selected = agent === tabAgent
            return (
              <button
                key={agent.card.paneKey}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActiveTab(agent.card.paneKey)}
                className={cn(
                  'inline-flex h-[30px] shrink-0 items-center gap-1.5 rounded-t-md px-2.5 text-xs whitespace-nowrap transition-colors',
                  selected
                    ? 'bg-foreground/6 text-foreground shadow-[inset_0_-2px_0_var(--pm-kind)]'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <AgentTypeIcon agentType={agent.card.agentType} size={12} />
                <span className="max-w-40 truncate">{projectMapAgentTitle(agent.card)}</span>
              </button>
            )
          })}
        </div>
      ) : null}
      {tabAgent ? (
        <ProjectMapConversation
          key={tabAgent.card.paneKey}
          card={tabAgent.card}
          session={tabAgent.session}
        />
      ) : subject.kind === 'workspace' ? (
        <div className="m-auto flex max-w-72 flex-col items-center gap-3 px-4 text-center text-sm text-muted-foreground">
          <MessageSquarePlus aria-hidden className="size-6" />
          <span>
            {translate('projectMap.window.noConversations', '{{name}} has no conversations yet.', {
              name: subject.workspace.worktreeName
            })}
          </span>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => onOpenWorkspace(subject.workspace)}
          >
            {translate('projectMap.window.openWorkspace', 'Open workspace')}
          </Button>
        </div>
      ) : null}
    </section>
  )
}

function AgentHeader({ agent }: { agent: ProjectMapAgent }): React.JSX.Element {
  const state = dashboardCardDisplayState(agent.card)
  return (
    <>
      <span className="inline-flex shrink-0">
        <AgentTypeIcon agentType={agent.card.agentType} size={15} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] font-semibold leading-[18px]">
          {projectMapAgentTitle(agent.card)}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 truncate text-[11px] leading-4 text-muted-foreground">
          <AgentStateDot state={state} title={null} />
          {[
            projectMapStateLabel(state),
            formatAgentTypeLabel(agent.card.agentType),
            agent.card.worktreeName
          ].join(' · ')}
        </span>
      </span>
    </>
  )
}

function WorkspaceHeader({ workspace }: { workspace: ProjectMapWorkspace }): React.JSX.Element {
  const Glyph = workspace.workspaceKind === 'folder' ? Folder : GitBranch
  return (
    <>
      <Glyph aria-hidden className="project-map-node-glyph size-4 shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] font-semibold leading-[18px]">
          {workspace.worktreeName}
        </span>
        <span className="truncate text-[11px] leading-4 text-muted-foreground">
          {translate('projectMap.node.conversationCount', '{{count}} conversations', {
            count: workspace.agentPaneKeys.length
          })}
          {workspace.hostLabel ? ` · ${workspace.hostLabel}` : ''}
        </span>
      </span>
    </>
  )
}
