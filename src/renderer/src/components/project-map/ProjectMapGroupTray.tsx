import { useMemo, useState } from 'react'
import { Layers, ListTree, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AgentStateDot } from '@/components/AgentStateDot'
import { AgentTypeIcon } from '@/lib/agent-type-icon'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { writeConversationReferenceDrag } from '@/lib/conversation-reference-drag'
import { dashboardCardDisplayState } from '../../../../shared/dashboard-snapshot'
import type { ProjectMapAgent } from './project-map-graph'
import type { ProjectMapGroup } from './project-map-collapse'
import { projectMapAgentTitle, projectMapStateLabel } from './project-map-labels'
import { projectMapConversationReference } from './project-map-reference'
import {
  placeProjectMapWindow,
  type ProjectMapAvoidRect,
  type ProjectMapRect,
  type ProjectMapWindowLayer
} from './project-map-window-placement'

type Filter = 'all' | 'waiting' | 'working'

const SIZE = { width: 360, height: 460 }

type Row = { agent: ProjectMapAgent; depth: number }

function trayRows(group: ProjectMapGroup, agents: ReadonlyMap<string, ProjectMapAgent>): Row[] {
  const members = new Set(group.memberPaneKeys)
  const rows: Row[] = []
  const visit = (paneKey: string, depth: number): void => {
    const agent = agents.get(paneKey)
    if (!agent || !members.has(paneKey)) {
      return
    }
    rows.push({ agent, depth })
    for (const childKey of agent.childPaneKeys) {
      visit(childKey, depth + 1)
    }
  }
  group.childPaneKeys.forEach((paneKey) => visit(paneKey, 0))
  return rows
}

function rowFilter(agent: ProjectMapAgent): Exclude<Filter, 'all'> | null {
  const state = dashboardCardDisplayState(agent.card)
  if (state === 'waiting' || state === 'blocked') {
    return 'waiting'
  }
  return state === 'working' || state === 'monitoring' ? 'working' : null
}

/** The delegated chats behind a stack, listed beside it; opening one leaves the canvas as it is. */
export function ProjectMapGroupTray({
  group,
  parentTitle,
  agents,
  anchor,
  viewport,
  avoid,
  layer,
  onClose,
  onOpenMember,
  onExpand
}: {
  group: ProjectMapGroup
  parentTitle: string
  agents: ReadonlyMap<string, ProjectMapAgent>
  anchor: ProjectMapRect
  viewport: { width: number; height: number }
  avoid: ProjectMapAvoidRect[]
  layer: ProjectMapWindowLayer
  onClose: () => void
  onOpenMember: (paneKey: string) => void
  onExpand: () => void
}): React.JSX.Element {
  const [position] = useState(() => placeProjectMapWindow(anchor, SIZE, viewport, avoid))
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const rows = useMemo(() => trayRows(group, agents), [agents, group])
  const needle = query.trim().toLowerCase()
  const shown = rows.filter(
    ({ agent }) =>
      (filter === 'all' || rowFilter(agent) === filter) &&
      (!needle || projectMapAgentTitle(agent.card).toLowerCase().includes(needle))
  )
  const filters: { id: Filter; label: string }[] = [
    {
      id: 'all',
      label: translate('projectMap.group.filterAll', 'All {{count}}', { count: rows.length })
    },
    {
      id: 'waiting',
      label: translate('projectMap.group.filterWaiting', 'Needs you {{count}}', {
        count: group.counts.waiting
      })
    },
    {
      id: 'working',
      label: translate('projectMap.group.filterWorking', 'Working {{count}}', {
        count: group.counts.working
      })
    }
  ]

  const moveFocus = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return
    }
    const items = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-project-map-tray-row]')
    ]
    const active = document.activeElement
    const at = active instanceof HTMLButtonElement ? items.indexOf(active) : -1
    const next = items[event.key === 'ArrowDown' ? at + 1 : Math.max(0, at - 1)]
    if (next) {
      event.preventDefault()
      next.focus()
    }
  }

  return (
    <section
      role="dialog"
      aria-label={translate('projectMap.group.trayLabel', 'Chats {{name}} delegated', {
        name: parentTitle
      })}
      data-project-map-window=""
      data-project-map-tray=""
      data-project-map-node-window=""
      onClick={(event) => event.stopPropagation()}
      onPointerDownCapture={layer.onRaise}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={moveFocus}
      className="project-map-window pointer-events-auto absolute flex flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground"
      style={{
        zIndex: layer.zIndex,
        left: position.x,
        top: position.y,
        width: SIZE.width,
        height: Math.min(SIZE.height, Math.max(0, viewport.height - position.y - 8))
      }}
    >
      <header className="project-map-window-header flex h-12 shrink-0 items-center gap-2 border-b border-border pr-1.5 pl-3">
        <Layers aria-hidden className="project-map-node-glyph size-4 shrink-0" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13px] leading-[18px] font-semibold">
            {translate('projectMap.group.title', '{{count}} delegated chats', {
              count: group.childPaneKeys.length
            })}
          </span>
          <span className="truncate text-[11px] leading-4 text-muted-foreground">
            {parentTitle}
          </span>
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={translate('projectMap.group.expand', 'Show them on the map')}
          title={translate('projectMap.group.expand', 'Show them on the map')}
          onClick={onExpand}
        >
          <ListTree className="size-3.5" />
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
      <div className="flex shrink-0 flex-col gap-2 border-b border-border px-3 py-2.5">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={translate('projectMap.group.search', 'Filter by title')}
          aria-label={translate('projectMap.group.search', 'Filter by title')}
        />
        <div role="radiogroup" className="flex gap-1">
          {filters.map((option) => (
            <Button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={filter === option.id}
              size="xs"
              variant={filter === option.id ? 'secondary' : 'ghost'}
              onClick={() => setFilter(option.id)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>
      <ul className="flex min-h-0 flex-1 flex-col overflow-y-auto py-1 scrollbar-sleek">
        {shown.map(({ agent, depth }) => {
          const state = dashboardCardDisplayState(agent.card)
          const reference = projectMapConversationReference(agent)
          return (
            <li key={agent.card.paneKey}>
              <button
                type="button"
                data-project-map-tray-row={agent.card.paneKey}
                draggable={reference ? true : undefined}
                onDragStart={(event) => {
                  if (reference) {
                    writeConversationReferenceDrag(event.dataTransfer, reference)
                  }
                }}
                onClick={() => onOpenMember(agent.card.paneKey)}
                className={cn(
                  'flex w-full items-center gap-2 py-1.5 pr-3 text-left text-[12.5px] hover:bg-accent/50 focus-visible:bg-accent/60 focus-visible:outline-none',
                  rowFilter(agent) === 'waiting' && 'bg-accent/30'
                )}
                style={{ paddingLeft: 12 + depth * 16 }}
              >
                <AgentStateDot state={state} title={null} />
                <AgentTypeIcon agentType={agent.card.agentType} size={12} />
                <span className="min-w-0 flex-1 truncate">{projectMapAgentTitle(agent.card)}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {projectMapStateLabel(state)}
                </span>
              </button>
            </li>
          )
        })}
        {shown.length === 0 ? (
          <li className="px-3 py-4 text-center text-[12px] text-muted-foreground">
            {translate('projectMap.group.empty', 'No chats match.')}
          </li>
        ) : null}
      </ul>
    </section>
  )
}
