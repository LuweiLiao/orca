import { useEffect } from 'react'
import { growthNearestRow } from './growth-tree-keyboard-nav'
import type { GrowthLayout } from './growth-tree-layout'
import type { ProjectMapArrow } from './project-map-keyboard-nav'

const ARROWS: Record<string, ProjectMapArrow | undefined> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down'
}

type Keys = {
  active: boolean
  layout: GrowthLayout
  selected: string | null
  cursor: string | null
  onCursor: (id: string | null) => void
  onSelect: (id: string | null) => void
  onJump: (id: string) => void
  /** Scrolls a row the keys moved to into view. */
  onReveal: (id: string) => void
}

function typingIn(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(
      'input, textarea, select, [contenteditable], [role="dialog"], [role="listbox"]'
    ) !== null
  )
}

/** Arrows reach only from the tree itself, so a toolbar menu keeps its own arrow keys. */
function onTree(target: EventTarget | null): boolean {
  return (
    target === document.body ||
    (target instanceof Element && target.closest('[data-growth-viewport]') !== null)
  )
}

/** Esc, plus arrows to walk the rows and Enter to select, then to jump. */
export function useGrowthTreeKeys(keys: Keys): void {
  const { active, layout, selected, cursor, onCursor, onSelect, onJump, onReveal } = keys
  useEffect(() => {
    if (!active) {
      return
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.metaKey ||
        event.ctrlKey ||
        typingIn(event.target)
      ) {
        return
      }
      const arrow = ARROWS[event.key]
      if (event.key === 'Escape' && (selected || cursor)) {
        onCursor(null)
        onSelect(null)
      } else if (arrow && onTree(event.target)) {
        event.preventDefault()
        const next = growthNearestRow(layout, cursor ?? selected, arrow)
        if (next) {
          onCursor(next)
          onReveal(next)
        }
      } else if (event.key === 'Enter' && onTree(event.target)) {
        const target = cursor ?? selected
        if (target) {
          event.preventDefault()
          if (target === selected) {
            onJump(target)
          } else {
            onSelect(target)
          }
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [active, layout, selected, cursor, onCursor, onSelect, onJump, onReveal])
}
