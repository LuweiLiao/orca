// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useRef, type ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SelectionAddToChatPopover } from './SelectionAddToChatPopover'

// Radix positions against layout happy-dom lacks; the open offer is drawn as Radix draws it.
vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: ReactNode }) => children,
  PopoverAnchor: () => null,
  PopoverContent: ({
    children,
    onOpenAutoFocus: _onOpenAutoFocus,
    onCloseAutoFocus: _onCloseAutoFocus,
    hideWhenDetached: _hideWhenDetached,
    collisionPadding: _collisionPadding,
    sideOffset: _sideOffset,
    align: _align,
    side: _side,
    ...props
  }: Record<string, unknown> & { children: ReactNode }) => (
    <div role="dialog" data-state="open" {...props}>
      {children}
    </div>
  )
}))

function Chat(): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  return (
    <div ref={rootRef}>
      <p data-testid="reply">The controller compensates the measured disturbance.</p>
      <SelectionAddToChatPopover
        rootRef={rootRef}
        enabled
        readQuotable={() => {
          const selection = window.getSelection()
          const text = selection?.toString() ?? ''
          return text && selection ? { text, range: selection.getRangeAt(0) } : null
        }}
        onAdd={() => {}}
      />
    </div>
  )
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  cleanup()
  window.getSelection()?.removeAllRanges()
  vi.useRealTimers()
})

it('offers the selection when Chromium dispatches selectionchange after mouseup', () => {
  render(<Chat />)
  const reply = screen.getByTestId('reply')
  fireEvent.pointerDown(reply, { button: 0 })
  // Holds back the selection's change event until after the release, as Chromium may.
  const held = (event: Event): void => event.stopImmediatePropagation()
  window.addEventListener('selectionchange', held, { capture: true })
  const range = document.createRange()
  range.selectNodeContents(reply)
  window.getSelection()!.addRange(range)
  fireEvent.mouseUp(reply, { button: 0, detail: 3 })
  window.removeEventListener('selectionchange', held, { capture: true })
  act(() => {
    vi.runOnlyPendingTimers()
  })
  expect(screen.getByRole('button', { name: 'Add to chat' })).toBeTruthy()
})
