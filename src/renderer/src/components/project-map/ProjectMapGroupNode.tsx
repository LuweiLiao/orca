import { memo } from 'react'
import { Layers } from 'lucide-react'
import { AgentStateDot } from '@/components/AgentStateDot'
import { translate } from '@/i18n/i18n'
import type { ProjectMapNodeBox } from './project-map-layout'
import { projectMapStateLabel } from './project-map-labels'
import type { ProjectMapGroup } from './project-map-collapse'
import { HeaderText, NodeShell } from './ProjectMapNode'

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
      headerOutPin={forksOut ? 'handoff' : undefined}
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
