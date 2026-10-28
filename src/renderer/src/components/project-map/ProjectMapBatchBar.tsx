import { BookMarked, EyeOff, MessageSquareQuote, Square, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { ProjectMapGraph } from './project-map-graph'
import type { ProjectMapBatchActionId } from './project-map-batch-plan'
import { useProjectMapBatchCommands } from './use-project-map-batch-commands'

type Props = {
  graph: ProjectMapGraph
  ids: readonly string[]
  onDone: () => void
}

const ACTIONS: {
  id: ProjectMapBatchActionId
  Icon: typeof BookMarked
  label: () => string
}[] = [
  {
    id: 'mark-read',
    Icon: BookMarked,
    label: () => translate('projectMap.batch.markRead', 'Mark as read')
  },
  {
    id: 'reference',
    Icon: MessageSquareQuote,
    label: () => translate('projectMap.batch.reference', 'Reference in current chat')
  },
  { id: 'hide', Icon: EyeOff, label: () => translate('projectMap.batch.hide', 'Hide') },
  { id: 'close', Icon: X, label: () => translate('projectMap.batch.close', 'Close') },
  { id: 'stop', Icon: Square, label: () => translate('projectMap.batch.stop', 'Stop') }
]

/** Acts on every chat picked with Shift, ⌘ or Ctrl; an action with nothing to do is greyed. */
export function ProjectMapBatchBar({ graph, ids, onDone }: Props): React.JSX.Element | null {
  const commands = useProjectMapBatchCommands(graph)
  const agents = ids.flatMap((id) => graph.agents.get(id) ?? [])
  if (agents.length < 2) {
    return null
  }
  return (
    <div
      role="toolbar"
      data-project-map-batch=""
      aria-label={translate('projectMap.batch.label', 'Actions on the selected conversations')}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      className="project-map-window absolute top-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-border bg-popover p-1.5 text-popover-foreground"
    >
      <span className="px-2 text-[12px] font-medium" data-project-map-batch-count="">
        {translate('projectMap.batch.selected', '{{count}} selected', { count: agents.length })}
      </span>
      {ACTIONS.map(({ id, Icon, label }) => (
        <Button
          key={id}
          type="button"
          variant="ghost"
          size="xs"
          data-project-map-batch-action={id}
          disabled={commands.plan(id, agents).targets.length === 0}
          onClick={() => void commands.run(id, agents).then((done) => done && onDone())}
        >
          <Icon className="size-3.5" />
          {label()}
        </Button>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={translate('projectMap.batch.clear', 'Clear selection')}
        onClick={onDone}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  )
}
