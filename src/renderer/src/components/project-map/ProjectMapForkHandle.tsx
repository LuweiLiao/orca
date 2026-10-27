import { Plus } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { PROJECT_MAP_NODE, wirePath } from './project-map-layout'
import type { ProjectMapForkDraft } from './use-project-map-fork-drag'

/** Where a node's fork wires leave it: the + handle and every draft wire start here. */
export function projectMapForkPin(box: { x: number; y: number; width: number }): {
  x: number
  y: number
} {
  return { x: box.x + box.width, y: box.y + PROJECT_MAP_NODE.headerPinOffsetY }
}

/** Sits on a node's fork pin, inside the scaled content so it pans with the node. */
export function ProjectMapForkHandle({
  box,
  open,
  unsupported,
  onPointerDown,
  onOpen,
  onHover
}: {
  box: { x: number; y: number; width: number }
  open: boolean
  unsupported: boolean
  onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void
  onOpen: () => void
  onHover: (inside: boolean) => void
}): React.JSX.Element {
  const label = translate('projectMap.fork.title', 'New child chat')
  const reason = unsupported
    ? translate(
        'projectMap.fork.hostUnsupported',
        "This chat's host runs an Orca version that cannot fork chats; update it to continue from here."
      )
    : null
  const pin = projectMapForkPin(box)
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={open}
      aria-disabled={unsupported || undefined}
      title={
        reason ??
        translate('projectMap.fork.handleHint', 'Click, or drag onto the map to place the new chat')
      }
      data-project-map-fork-handle=""
      onPointerDown={(event) => {
        event.stopPropagation()
        if (!unsupported) {
          onPointerDown(event)
        }
      }}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
      onClick={(event) => {
        event.stopPropagation()
        if (!unsupported) {
          onOpen()
        }
      }}
      className="project-map-fork-handle absolute z-10 grid size-[22px] -translate-x-1/2 -translate-y-1/2 touch-none place-items-center rounded-full bg-primary text-primary-foreground"
      style={{ left: pin.x + 4, top: pin.y }}
    >
      <Plus aria-hidden className="size-3.5" />
    </button>
  )
}

/** The dashed wire and outline of the chat a drag will create, drawn under the pointer. */
export function ProjectMapForkGhost({
  from,
  draft,
  originTitle
}: {
  from: { x: number; y: number }
  draft: ProjectMapForkDraft
  originTitle: string
}): React.JSX.Element {
  const { x, y } = draft.point
  const hint = draft.blocked
    ? translate('projectMap.fork.dropBlocked', 'Drop it on an empty spot')
    : draft.placed
      ? translate('projectMap.fork.subtitle', 'From {{name}}', {
          name: originTitle
        })
      : translate('projectMap.fork.dropHint', 'Release to place it here')
  return (
    <>
      <svg
        aria-hidden
        className="pointer-events-none absolute top-0 left-0 overflow-visible"
        width={1}
        height={1}
      >
        <path
          className="project-map-wire"
          data-kind="fork-draft"
          data-highlighted="true"
          data-blocked={draft.blocked || undefined}
          d={wirePath(from.x, from.y, x, y)}
        />
      </svg>
      <div
        aria-hidden
        data-project-map-fork-draft={draft.placed ? 'placed' : 'dragging'}
        data-blocked={draft.blocked || undefined}
        className="project-map-ghost-node pointer-events-none absolute flex items-center gap-2 px-2.5"
        style={{
          left: x,
          top: y - PROJECT_MAP_NODE.headerPinOffsetY,
          width: PROJECT_MAP_NODE.agentWidth,
          height: PROJECT_MAP_NODE.height
        }}
      >
        <span className="project-map-fork-pin" data-side="in" data-wire="fork" />
        <Plus aria-hidden className="project-map-fork-glyph size-4 shrink-0" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13px] leading-[17px] font-semibold">
            {translate('projectMap.fork.title', 'New child chat')}
          </span>
          <span className="truncate text-[11px] leading-[15px] text-muted-foreground">{hint}</span>
        </span>
      </div>
    </>
  )
}
