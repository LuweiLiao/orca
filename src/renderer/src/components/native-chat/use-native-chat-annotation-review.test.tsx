// @vitest-environment happy-dom
import { useRef } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useNativeChatAnnotationReview } from './use-native-chat-annotation-review'
import type { NativeChatComposerHandle } from './native-chat-composer-types'
import { getNativeChatAnnotationsStore } from './native-chat-annotations-store'

vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))

const appendText = vi.fn<(text: string) => void>()
const appendTextDurably = vi.fn((text: string) => {
  appendText(text)
  return true
})
const acceptsText = vi.fn(() => true)
const focus = vi.fn(() => true)
const composer: NativeChatComposerHandle = {
  appendText,
  appendTextDurably,
  acceptsText,
  focus,
  insertTypedText: () => true,
  handlePasteEvent: () => {},
  pasteFromClipboard: () => {},
  contains: () => false
}

function Harness({ scopeKey }: { scopeKey: string }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const review = useNativeChatAnnotationReview({
    scopeKey,
    rootRef,
    composerRef: { current: composer },
    enabled: true
  })
  return (
    <TooltipProvider>
      <div ref={rootRef}>
        <div data-native-chat-message-id="reply">
          <p data-native-chat-quote-source="">first sentence. second sentence.</p>
        </div>
        <button
          onClick={() =>
            review.begin?.({ messageId: 'reply', quote: 'first sentence.', startOffset: 0 })
          }
        >
          First
        </button>
        <button
          onClick={() =>
            review.begin?.({ messageId: 'reply', quote: 'second sentence.', startOffset: 16 })
          }
        >
          Second
        </button>
        {review.tray}
      </div>
    </TooltipProvider>
  )
}

function comment(text: string): void {
  fireEvent.change(screen.getByRole('textbox', { name: 'Comment' }), { target: { value: text } })
}

afterEach(() => {
  cleanup()
  appendText.mockClear()
  appendTextDurably.mockReset().mockImplementation((text) => {
    appendText(text)
    return true
  })
  focus.mockClear()
  acceptsText.mockReturnValue(true)
  vi.restoreAllMocks()
})

describe('conversation annotation review', () => {
  it('shows legacy notes, the unfinished editor and retry when migration cannot write', () => {
    const scope = 'review-refused-migration'
    const anchor = { messageId: 'reply', quote: 'first sentence.', startOffset: 0 }
    localStorage.setItem(
      `orca:native-chat-annotations:v1:${scope}`,
      JSON.stringify({
        version: 1,
        notes: [{ ...anchor, id: 'legacy', comment: 'Saved legacy comment', createdAt: 1 }],
        editor: { anchor, comment: 'Unfinished legacy editor' }
      })
    )
    const blocked = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('Full')
    })
    render(<Harness scopeKey={scope} />)
    expect(screen.getByText('Saved legacy comment')).toBeTruthy()
    const input = screen.getByRole('textbox', { name: 'Comment' })
    expect(input instanceof HTMLTextAreaElement && input.value).toBe('Unfinished legacy editor')
    expect(screen.getByRole('status').textContent).toContain('Annotations could not be saved')
    blocked.mockRestore()
    fireEvent.click(screen.getByRole('button', { name: 'Retry saving annotations' }))
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByText('Saved legacy comment')).toBeTruthy()
  })

  it('keeps an error and retry visible even when no annotations could be read', () => {
    const scope = 'review-unreadable-migration'
    localStorage.setItem(`orca:native-chat-annotations:v1:${scope}`, '{invalid')
    render(<Harness scopeKey={scope} />)
    expect(screen.getByRole('region', { name: 'Annotations' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry saving annotations' })).toBeTruthy()
    localStorage.removeItem(`orca:native-chat-annotations:v1:${scope}`)
    fireEvent.click(screen.getByRole('button', { name: 'Retry saving annotations' }))
    expect(screen.queryByRole('region', { name: 'Annotations' })).toBeNull()
  })
  it('retains notes when saving to the composer fails', () => {
    render(<Harness scopeKey="review-transfer-failure" />)
    fireEvent.click(screen.getByRole('button', { name: 'First' }))
    comment('Keep this saved comment.')
    fireEvent.click(screen.getByRole('button', { name: 'Save annotation' }))
    appendTextDurably.mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: 'Add annotations to message' }))
    expect(screen.getByText('Keep this saved comment.')).toBeTruthy()
    expect(focus).not.toHaveBeenCalled()
  })
  it('keeps several notes editable and transfers their quotes together without sending', () => {
    render(<Harness scopeKey="review-flow" />)
    fireEvent.click(screen.getByRole('button', { name: 'First' }))
    comment('Explain the first mechanism.')
    fireEvent.click(screen.getByRole('button', { name: 'Save annotation' }))
    fireEvent.click(screen.getByRole('button', { name: 'Second' }))
    comment('Add the units.')
    fireEvent.click(screen.getByRole('button', { name: 'Save annotation' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit annotation' })[0])
    comment('Explain the control mechanism.')
    fireEvent.click(screen.getByRole('button', { name: 'Save annotation' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add annotations to message' }))
    expect(appendText).toHaveBeenCalledTimes(1)
    const message = appendText.mock.calls[0][0]
    expect(message).toContain('> first sentence.\n\nExplain the control mechanism.')
    expect(message).toContain('> second sentence.\n\nAdd the units.')
    expect(message).not.toContain('Explain the first mechanism.')
    expect(screen.queryByRole('region', { name: 'Annotations' })).toBeNull()
    expect(focus).toHaveBeenCalledOnce()
  })

  it('restores saved notes, isolates conversations and deletes only the chosen note', () => {
    const view = render(<Harness scopeKey="review-restore" />)
    fireEvent.click(screen.getByRole('button', { name: 'First' }))
    comment('Keep this note.')
    fireEvent.click(screen.getByRole('button', { name: 'Save annotation' }))
    view.rerender(<Harness scopeKey="another-conversation" />)
    expect(screen.queryByRole('region', { name: 'Annotations' })).toBeNull()
    view.rerender(<Harness scopeKey="review-restore" />)
    expect(screen.getByText('Keep this note.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete annotation' }))
    expect(screen.queryByRole('region', { name: 'Annotations' })).toBeNull()
  })

  it('keeps notes while the composer cannot accept text and transfers them after it unlocks', () => {
    render(<Harness scopeKey="review-held" />)
    fireEvent.click(screen.getByRole('button', { name: 'First' }))
    comment('Keep while answering a question.')
    fireEvent.click(screen.getByRole('button', { name: 'Save annotation' }))
    acceptsText.mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: 'Add annotations to message' }))
    expect(appendText).not.toHaveBeenCalled()
    expect(screen.getByText('Keep while answering a question.')).toBeTruthy()
    acceptsText.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'Add annotations to message' }))
    expect(appendText).toHaveBeenCalledOnce()
  })

  it('saves an unfinished nonempty comment when annotating another passage', () => {
    render(<Harness scopeKey="review-selection-change" />)
    fireEvent.click(screen.getByRole('button', { name: 'First' }))
    comment('Preserve my current comment.')
    fireEvent.click(screen.getByRole('button', { name: 'Second' }))
    expect(screen.getByText('Preserve my current comment.')).toBeTruthy()
    const input = screen.getByRole('textbox', { name: 'Comment' })
    expect(input instanceof HTMLTextAreaElement && input.value).toBe('')
  })

  it('restores unfinished comments after remount and when switching conversations', () => {
    const view = render(<Harness scopeKey="review-draft-remount" />)
    fireEvent.click(screen.getByRole('button', { name: 'First' }))
    comment('Preserve this unfinished draft.')
    view.rerender(<Harness scopeKey="review-draft-other" />)
    fireEvent.click(screen.getByRole('button', { name: 'Second' }))
    comment('Another conversation draft.')
    view.rerender(<Harness scopeKey="review-draft-remount" />)
    const input = screen.getByRole('textbox', { name: 'Comment' })
    expect(input instanceof HTMLTextAreaElement && input.value).toBe(
      'Preserve this unfinished draft.'
    )
    view.unmount()
    render(<Harness scopeKey="review-draft-remount" />)
    const restored = screen.getByRole('textbox', { name: 'Comment' })
    expect(restored instanceof HTMLTextAreaElement && restored.value).toBe(
      'Preserve this unfinished draft.'
    )
  })

  it('recovers the edited comment when another pane deletes the saved note', () => {
    render(<Harness scopeKey="review-deleted-while-editing" />)
    fireEvent.click(screen.getByRole('button', { name: 'First' }))
    comment('Original comment.')
    fireEvent.click(screen.getByRole('button', { name: 'Save annotation' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit annotation' }))
    comment('Keep the current edit.')
    const store = getNativeChatAnnotationsStore('review-deleted-while-editing')
    act(() => {
      store.remove(store.getSnapshot().notes[0].id)
    })
    expect(screen.getByRole('textbox', { name: 'Comment' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save annotation' }))
    expect(screen.getByText('Keep the current edit.')).toBeTruthy()
  })
})
