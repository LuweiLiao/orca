import { useCallback, useState } from 'react'
import type { ProjectMapAgent, ProjectMapGraph, ProjectMapWorkspace } from './project-map-graph'
import type { ProjectMapLayout } from './project-map-layout'
import {
  projectMapNearestNode,
  projectMapNodeInView,
  type ProjectMapArrow
} from './project-map-keyboard-nav'
import type { ProjectMapRowDirection } from './project-map-row-moves'
import type { useProjectMapViewport } from './use-project-map-viewport'

/** Keys that act on focus inside these belong to them: a chat box, a field, a menu, a window. */
const OWN_KEYS =
  'input, textarea, select, [contenteditable], [role="menu"], [role="dialog"], [data-project-map-window]'

const ARROWS: Record<string, ProjectMapArrow> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down'
}
const ZOOM_STEP = 1.2

type Options = {
  graph: ProjectMapGraph
  layout: ProjectMapLayout
  viewport: Pick<ReturnType<typeof useProjectMapViewport>, 'centerOn' | 'zoomBy' | 'view' | 'size'>
  /** The node whose window is open. */
  selected: string | null
  /** Click-style selection, which also drops merge picks. */
  open: (id: string) => void
  /** Adds the node to the merge, or takes it out. */
  togglePick: (id: string) => void
  onOpenAgent: (agent: ProjectMapAgent) => void
  onOpenWorkspace: (workspace: ProjectMapWorkspace) => void
  onRename: (paneKey: string) => void
  onMoveRow: (paneKey: string, direction: ProjectMapRowDirection) => void
  /** Esc: drop the selection and merge picks. */
  onEscape: () => void
  /** Bound to Delete and Backspace when given. */
  onDelete?: (id: string) => void
  /** Bound to ⌘/Ctrl+Z when given. */
  onUndo?: () => void
}

/**
 * Keys for the map while its viewport has focus. A cursor walks the nodes without opening
 * anything (a window's box takes focus as it opens); Enter opens the one it is on. Returns the cursor and the handlers for the viewport.
 */
export function useProjectMapKeyboard(options: Options) {
  const { graph, layout, viewport, selected } = options
  const [cursor, setCursor] = useState<string | null>(null)
  const current = cursor && layout.nodes.has(cursor) ? cursor : selected
  const moveTo = useCallback(
    (id: string): void => {
      const box = layout.nodes.get(id)
      setCursor(id)
      if (box && !projectMapNodeInView(box, viewport.view, viewport.size)) {
        viewport.centerOn({ ...box, height: 66 })
      }
    },
    [layout.nodes, viewport]
  )

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (event.defaultPrevented || ownsKeys(event.target)) {
      return
    }
    const mod = event.metaKey || event.ctrlKey
    const handled = (): void => {
      event.preventDefault()
      event.stopPropagation()
    }
    const arrow = ARROWS[event.key]
    if (mod && event.key.toLowerCase() === 'z' && !event.shiftKey && !event.altKey) {
      if (options.onUndo) {
        handled()
        options.onUndo()
      }
      return
    }
    if (mod) {
      return
    }
    if (arrow && event.altKey && !event.shiftKey) {
      if ((arrow === 'up' || arrow === 'down') && current && graph.agents.has(current)) {
        handled()
        options.onMoveRow(current, arrow)
      }
      return
    }
    if (arrow && !event.altKey) {
      handled()
      const next = projectMapNearestNode(layout.nodes.values(), current, arrow)
      if (next) {
        moveTo(next)
      }
      return
    }
    if (event.altKey) {
      return
    }
    if (event.key === '+' || event.key === '=') {
      handled()
      viewport.zoomBy(ZOOM_STEP)
    } else if (event.key === '-' || event.key === '_') {
      handled()
      viewport.zoomBy(1 / ZOOM_STEP)
    } else if (event.key === 'Escape') {
      setCursor(null)
      options.onEscape()
    } else if (current && event.key === 'Enter') {
      handled()
      const agent = graph.agents.get(current)
      const workspace = graph.workspaces.get(current)
      if (!event.shiftKey) {
        options.open(current)
      } else if (agent) {
        options.onOpenAgent(agent)
      } else if (workspace) {
        options.onOpenWorkspace(workspace)
      }
    } else if (current && event.key === ' ') {
      handled()
      options.togglePick(current)
    } else if (current && event.key === 'F2') {
      handled()
      if (graph.agents.get(current)?.history === undefined && graph.agents.has(current)) {
        options.onRename(current)
      }
    } else if (
      current &&
      (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey))
    ) {
      handled()
      openContextMenuOn(current)
    } else if (
      current &&
      (event.key === 'Delete' || event.key === 'Backspace') &&
      options.onDelete
    ) {
      handled()
      options.onDelete(current)
    }
  }

  // A button also fires on Space's key-up; the keys above were already taken on key-down.
  const onKeyUp = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (event.key === ' ' && !ownsKeys(event.target)) {
      event.preventDefault()
    }
  }

  return { cursor: current, clearCursor: () => setCursor(null), onKeyDown, onKeyUp }
}

const ownsKeys = (target: EventTarget): boolean =>
  target instanceof Element && target.closest(OWN_KEYS) !== null

/** The menu opens from a right-click on the node, so the keyboard sends it one at its centre. */
function openContextMenuOn(id: string): void {
  const element = document.querySelector(`[data-project-map-node="${CSS.escape(id)}"]`)
  const rect = element?.getBoundingClientRect()
  if (!element || !rect) {
    return
  }
  element.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2
    })
  )
}
