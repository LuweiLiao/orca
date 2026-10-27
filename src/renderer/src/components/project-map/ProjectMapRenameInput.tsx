import { useEffect, useRef } from 'react'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import type { ProjectMapNodeBox } from './project-map-layout'

const TITLE_LEFT = 32
const TITLE_RIGHT = 28
const HEADER_INPUT_HEIGHT = 28

type Props = {
  box: ProjectMapNodeBox
  title: string
  /** An empty name asks for the default one back. */
  onCommit: (title: string | null) => void
  onCancel: () => void
}

/** Edits a node's title over it: the node itself is a button, which cannot hold an input. */
export function ProjectMapRenameInput({
  box,
  title,
  onCommit,
  onCancel
}: Props): React.JSX.Element {
  const resolved = useRef(false)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    // Why: the context menu hands focus back as it closes; wait for it before taking focus.
    const frame = requestAnimationFrame(() => {
      ref.current?.focus()
      ref.current?.select()
    })
    return () => cancelAnimationFrame(frame)
  }, [])
  const finish = (commit: boolean): void => {
    if (resolved.current) {
      return
    }
    resolved.current = true
    if (!commit) {
      onCancel()
      return
    }
    const next = (ref.current?.value ?? '').trim()
    if (next === title) {
      onCancel()
    } else {
      onCommit(next.length > 0 ? next : null)
    }
  }
  return (
    <div
      data-project-map-rename=""
      className="absolute z-10 flex items-center"
      style={{
        left: box.x + TITLE_LEFT,
        top: box.y + 6,
        width: box.width - TITLE_LEFT - TITLE_RIGHT,
        height: HEADER_INPUT_HEIGHT
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
    >
      <Input
        ref={ref}
        defaultValue={title}
        aria-label={translate('projectMap.rename.label', 'Conversation name')}
        density="compact"
        onBlur={() => finish(true)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            finish(true)
          } else if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            finish(false)
          }
        }}
      />
    </div>
  )
}
