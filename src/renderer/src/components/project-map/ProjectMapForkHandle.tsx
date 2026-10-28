import { Columns2, GitMerge, Plus } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { PROJECT_MAP_NODE, wirePath, type ProjectMapLayout } from './project-map-layout'
import type { ProjectMapGraph } from './project-map-graph'
import { projectMapAgentTitle } from './project-map-labels'
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
        "This chat's host runs an Orca version that cannot hand off chats; update it to continue from here."
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

const NO_PINS: readonly { x: number; y: number }[] = []

/** The faint wire and outline of the chat a drag will create, drawn under the pointer. */
export function ProjectMapForkGhost({
  from,
  draft,
  originTitle,
  mergeFrom = NO_PINS
}: {
  from: { x: number; y: number }
  draft: ProjectMapForkDraft
  originTitle: string
  /** A merge: the other chats' fork pins, each wired to the ghost too. */
  mergeFrom?: readonly { x: number; y: number }[]
}): React.JSX.Element {
  const merging = mergeFrom.length > 0
  const { x, y } = draft.point
  const hint = draft.blocked
    ? translate('projectMap.fork.dropBlocked', 'Drop it on an empty spot')
    : !draft.placed
      ? translate('projectMap.fork.dropHint', 'Release to place it here')
      : merging
        ? translate('projectMap.merge.subtitle', 'From {{count}} chats', {
            count: mergeFrom.length + 1
          })
        : translate('projectMap.fork.subtitle', 'From {{name}}', { name: originTitle })
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
        {mergeFrom.map((pin) => (
          <path
            key={`${pin.x}:${pin.y}`}
            className="project-map-wire"
            data-kind="fork-draft"
            data-merge=""
            data-highlighted="true"
            data-blocked={draft.blocked || undefined}
            d={wirePath(pin.x, pin.y, x, y)}
          />
        ))}
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
        <span className="project-map-fork-pin" data-side="in" data-wire="handoff" />
        {merging ? (
          <GitMerge aria-hidden className="project-map-fork-glyph size-4 shrink-0" />
        ) : (
          <Plus aria-hidden className="project-map-fork-glyph size-4 shrink-0" />
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13px] leading-[17px] font-semibold">
            {merging
              ? translate('projectMap.merge.ghost', 'Merged handoff from {{count}} chats', {
                  count: mergeFrom.length + 1
                })
              : translate('projectMap.fork.title', 'New child chat')}
          </span>
          <span className="truncate text-[11px] leading-[15px] text-muted-foreground">{hint}</span>
        </span>
      </div>
    </>
  )
}

/** The ghost of a drag in progress, wired from its chat and, for a merge, from the others. */
export function ProjectMapDraftGhost({
  draft,
  layout,
  graph
}: {
  draft: ProjectMapForkDraft | null
  layout: ProjectMapLayout
  graph: ProjectMapGraph
}): React.JSX.Element | null {
  const from = draft ? layout.nodes.get(draft.originId) : undefined
  const origin = draft ? graph.agents.get(draft.originId) : undefined
  if (!draft || !from || !origin) {
    return null
  }
  return (
    <ProjectMapForkGhost
      from={projectMapForkPin(from)}
      draft={draft}
      originTitle={projectMapAgentTitle(origin.card)}
      mergeFrom={(draft.mergeWith ?? []).flatMap((id) => {
        const box = layout.nodes.get(id)
        return box ? [projectMapForkPin(box)] : []
      })}
    />
  )
}

/**
 * Beside the picked chats: click to merge them into a new chat, or drag it out to place one.
 * Two picked chats can also be compared.
 */
export function ProjectMapMergeHandle({
  boxes,
  onPointerDown,
  onOpen,
  onCompare
}: {
  boxes: readonly { x: number; y: number; width: number }[]
  onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void
  onOpen: () => void
  onCompare?: () => void
}): React.JSX.Element {
  const right = Math.max(...boxes.map((box) => box.x + box.width))
  const top = Math.min(...boxes.map((box) => box.y))
  const bottom = Math.max(...boxes.map((box) => box.y + PROJECT_MAP_NODE.height))
  const label = translate('projectMap.merge.handle', 'Merged handoff · {{count}} chats', {
    count: boxes.length
  })
  const middle = (top + bottom) / 2
  return (
    <>
      <button
        type="button"
        aria-label={label}
        title={translate(
          'projectMap.merge.handleHint',
          'Click, or drag onto the map to place the merged handoff'
        )}
        data-project-map-merge-handle=""
        onPointerDown={(event) => {
          event.stopPropagation()
          onPointerDown(event)
        }}
        onClick={(event) => {
          event.stopPropagation()
          onOpen()
        }}
        className="project-map-fork-handle absolute z-10 flex h-[26px] -translate-y-1/2 touch-none items-center gap-1 rounded-full bg-primary px-2.5 text-[12px] font-medium text-primary-foreground"
        style={{ left: right + 14, top: middle }}
      >
        <GitMerge aria-hidden className="size-3.5" />
        {label}
      </button>
      {onCompare ? (
        <button
          type="button"
          data-project-map-compare-handle=""
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            onCompare()
          }}
          className="project-map-fork-handle absolute z-10 flex h-[26px] -translate-y-1/2 items-center gap-1 rounded-full border border-border bg-popover px-2.5 text-[12px] font-medium text-popover-foreground"
          style={{ left: right + 14, top: middle + 34 }}
        >
          <Columns2 aria-hidden className="size-3.5" />
          {translate('projectMap.compare.handle', 'Compare')}
        </button>
      ) : null}
    </>
  )
}
