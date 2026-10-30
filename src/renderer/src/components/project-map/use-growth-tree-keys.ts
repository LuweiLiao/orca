import { useEffect } from 'react'
import { growthBarInView, growthNearestBar } from './growth-tree-keyboard-nav'
import type { GrowthLayout } from './growth-tree-layout'
import type { ProjectMapArrow } from './project-map-keyboard-nav'
import type { ProjectMapView } from './use-project-map-viewport'

const ARROWS: Record<string, ProjectMapArrow | undefined> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down'
}

type Keys = {
  active: boolean
  /** The summary tier draws no chats, so there is nothing for the arrows to walk. */
  summary: boolean
  layout: GrowthLayout
  view: ProjectMapView
  size: { width: number; height: number }
  selected: string | null
  cursor: string | null
  onCursor: (id: string | null) => void
  onSelect: (id: string | null) => void
  onJump: (id: string) => void
  onFit: () => void
  onZoom: (factor: number) => void
  onCenter: (box: { x: number; y: number; width: number; height: number }) => void
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
    (target instanceof Element &&
      target.closest('[data-growth-world], [data-growth-labels], [data-growth-viewport]') !== null)
  )
}

/** Esc, fit and zoom keys, plus arrows to walk the chats and Enter to select, then to jump. */
export function useGrowthTreeKeys(keys: Keys): void {
  const { active, summary, layout, view, size, selected, cursor } = keys
  const { onCursor, onSelect, onJump, onFit, onZoom, onCenter } = keys
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
      } else if (arrow && !summary && onTree(event.target)) {
        event.preventDefault()
        const next = growthNearestBar(layout, cursor ?? selected, arrow)
        const bar = next ? layout.bars.get(next) : undefined
        if (bar) {
          onCursor(bar.id)
          if (!growthBarInView(bar, view, size)) {
            onCenter(bar)
          }
        }
      } else if (event.key === 'Enter' && !summary && onTree(event.target)) {
        const target = cursor ?? selected
        if (target) {
          event.preventDefault()
          if (target === selected) {
            onJump(target)
          } else {
            onSelect(target)
          }
        }
      } else if (event.key.toLowerCase() === 'f' && !event.shiftKey) {
        onFit()
      } else if (event.key === '+' || event.key === '=') {
        onZoom(1.2)
      } else if (event.key === '-') {
        onZoom(1 / 1.2)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [
    active,
    summary,
    layout,
    view,
    size,
    selected,
    cursor,
    onCursor,
    onSelect,
    onJump,
    onFit,
    onZoom,
    onCenter
  ])
}
