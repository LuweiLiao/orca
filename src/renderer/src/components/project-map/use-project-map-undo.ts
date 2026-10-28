import { useEffect } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'

const MAX_UNDO = 20

export type ProjectMapUndoEntry = {
  label: string
  /** Throws when it cannot (a host that cannot be reached); the entry stays for another try. */
  undo: () => Promise<void> | void
}

const stack: ProjectMapUndoEntry[] = []

export function pushProjectMapUndo(entry: ProjectMapUndoEntry): void {
  stack.push(entry)
  if (stack.length > MAX_UNDO) {
    stack.shift()
  }
}

async function runUndo(entry: ProjectMapUndoEntry): Promise<boolean> {
  try {
    await entry.undo()
    return true
  } catch {
    stack.push(entry)
    toast.error(
      translate('projectMap.undo.failed', 'Could not undo "{{label}}". Is its host reachable?', {
        label: entry.label
      })
    )
    return false
  }
}

/** Takes back the newest action; false when there was nothing, or it failed and said so. */
export async function undoProjectMap(): Promise<boolean> {
  const entry = stack.pop()
  return entry ? runUndo(entry) : false
}

/** Pushes an action and offers its undo in a toast. */
export function pushProjectMapUndoWithToast(entry: ProjectMapUndoEntry, message: string): void {
  pushProjectMapUndo(entry)
  toast(message, {
    action: {
      label: translate('projectMap.undo.action', 'Undo'),
      onClick: () => {
        // Why: the toast undoes its own action, not whatever is newest by now.
        const at = stack.lastIndexOf(entry)
        if (at !== -1) {
          stack.splice(at, 1)
          void runUndo(entry)
        }
      }
    }
  })
}

export function projectMapUndoDepth(): number {
  return stack.length
}

/** ⌘/Ctrl+Z on the map; a chat window or any field keeps the key for itself. */
export function useProjectMapUndoKey(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== 'z' ||
        event.defaultPrevented ||
        (target instanceof Element &&
          (target.closest('[data-project-map-window]') ||
            target.closest('input, textarea, select, [contenteditable]')))
      ) {
        return
      }
      if (stack.length === 0) {
        return
      }
      event.preventDefault()
      void undoProjectMap()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])
}
