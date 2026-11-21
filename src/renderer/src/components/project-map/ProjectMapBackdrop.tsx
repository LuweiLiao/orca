import { translate } from '@/i18n/i18n'
import type { ProjectMapLayout } from './project-map-layout'

/** Workspace lanes, the strip for workspaces with nothing in them, and the wires between nodes. */
export function ProjectMapBackdrop({
  layout,
  activeWorktreeId,
  selectedShown
}: {
  layout: ProjectMapLayout
  activeWorktreeId: string | null
  selectedShown: string | null
}): React.JSX.Element {
  return (
    <>
      {layout.lanes.map((lane) => (
        <div
          key={lane.workspaceId}
          aria-hidden
          data-current={lane.workspaceId === activeWorktreeId}
          className="project-map-lane absolute"
          style={{
            left: lane.x,
            top: lane.y,
            width: layout.width - lane.x - 16,
            height: lane.height
          }}
        />
      ))}
      {layout.looseGroup ? (
        <div
          className="project-map-loose absolute"
          style={{
            left: 16,
            right: 16,
            top: layout.looseGroup.y,
            height: layout.looseGroup.height
          }}
        >
          <span className="absolute top-1.5 left-3 text-[11px] font-semibold tracking-wide text-muted-foreground">
            {translate('projectMap.looseGroup', 'No lineage or conversations')}
          </span>
        </div>
      ) : null}
      <svg
        aria-hidden
        className="pointer-events-none absolute top-0 left-0 overflow-visible"
        width={layout.width}
        height={layout.height}
      >
        {layout.wires.map((wire) => {
          const highlighted = wire.from === selectedShown || wire.to === selectedShown
          // A backward reference would cross the map; it shows only beside its selected end.
          return wire.backward && !highlighted ? null : (
            <path
              key={`${wire.kind}:${wire.from}:${wire.to}`}
              className="project-map-wire"
              data-kind={wire.kind}
              data-live={wire.live || undefined}
              data-highlighted={highlighted}
              d={wire.path}
            />
          )
        })}
      </svg>
    </>
  )
}
