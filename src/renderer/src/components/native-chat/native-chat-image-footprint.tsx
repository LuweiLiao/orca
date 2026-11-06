import { Image as ImageIcon } from 'lucide-react'

export type NativeChatImageFootprint = { width: number; height: number }

// Bounded so a long-lived renderer does not keep one entry per image it ever drew.
const MAX_REMEMBERED_FOOTPRINTS = 1000
const footprints = new Map<string, NativeChatImageFootprint>()

/** The size a chat image last drew at, kept across remounts so its placeholder holds the row's height. */
export function nativeChatImageFootprint(key: string): NativeChatImageFootprint | undefined {
  return footprints.get(key)
}

export function rememberNativeChatImageFootprint(
  key: string,
  footprint: NativeChatImageFootprint
): void {
  if (!(footprint.width > 0 && footprint.height > 0)) {
    return
  }
  footprints.delete(key)
  footprints.set(key, footprint)
  if (footprints.size > MAX_REMEMBERED_FOOTPRINTS) {
    const oldest = footprints.keys().next().value
    if (oldest !== undefined) {
      footprints.delete(oldest)
    }
  }
}

/** Stands in for an unloaded full-size image at the height its `max-h-96 max-w-full` box would draw. */
export function NativeChatReservedImageBox({
  footprint
}: {
  footprint: NativeChatImageFootprint
}): React.JSX.Element {
  return (
    <div className="flex w-full items-center justify-center overflow-hidden rounded-md border border-border bg-chat-canvas text-chat-foreground-faint">
      <div
        className="flex max-h-96 max-w-full items-center justify-center"
        style={{
          width: footprint.width,
          aspectRatio: `${footprint.width} / ${footprint.height}`
        }}
      >
        <ImageIcon className="size-4 shrink-0" />
      </div>
    </div>
  )
}

export function resetNativeChatImageFootprintsForTests(): void {
  footprints.clear()
}
