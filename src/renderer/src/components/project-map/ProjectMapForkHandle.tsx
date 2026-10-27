import { Plus } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { PROJECT_MAP_NODE } from './project-map-layout'

/** Sits on the selected node's fork pin, inside the scaled content so it pans with the node. */
export function ProjectMapForkHandle({
  box,
  open,
  unsupported,
  onOpen
}: {
  box: { x: number; y: number; width: number }
  open: boolean
  unsupported: boolean
  onOpen: () => void
}): React.JSX.Element {
  const label = translate('projectMap.fork.title', 'New child chat')
  const reason = unsupported
    ? translate(
        'projectMap.fork.hostUnsupported',
        "This chat's host runs an Orca version that cannot fork chats; update it to continue from here."
      )
    : null
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={open}
      aria-disabled={unsupported || undefined}
      title={reason ?? label}
      data-project-map-fork-handle=""
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        if (!unsupported) {
          onOpen()
        }
      }}
      className="project-map-fork-handle absolute z-10 grid size-[22px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-primary text-primary-foreground"
      style={{ left: box.x + box.width + 4, top: box.y + PROJECT_MAP_NODE.headerPinOffsetY }}
    >
      <Plus aria-hidden className="size-3.5" />
    </button>
  )
}
