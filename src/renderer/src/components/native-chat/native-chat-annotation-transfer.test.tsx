// @vitest-environment happy-dom
import { useRef } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useNativeChatAnnotationReview } from './use-native-chat-annotation-review'
import { useNativeChatComposerHandle } from './use-native-chat-composer-handle'
import { useNativeChatDraft } from './use-native-chat-draft'
import { readNativeChatDraftJournalRecords } from './native-chat-composer-draft-journal-records'
import { getNativeChatAnnotationsStore } from './native-chat-annotations-store'
import type { NativeChatComposerHandle } from './native-chat-composer-types'
import {
  clearNativeChatComposerDraftsForTests,
  hydrateNativeChatComposerDrafts
} from './native-chat-composer-draft-store'
import {
  createMemoryNativeChatComposerDraftStorage,
  setNativeChatComposerDraftStorageForTests
} from './native-chat-composer-draft-storage'

vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
const scopeKey = 'annotation-transfer'
const draftKey = 'agent-session:annotation-transfer'
const anchor = { messageId: 'reply', quote: 'Original sentence.', startOffset: 0 }

function Harness() {
  const rootRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const composerRef = useRef<NativeChatComposerHandle>(null)
  const { draft, setDraft } = useNativeChatDraft(draftKey, () => false)
  useNativeChatComposerHandle(composerRef, {
    textareaRef,
    isComposing: () => false,
    setDraft,
    setCaret: () => {},
    setActiveSuggestion: () => {},
    attachmentScopeKey: draftKey,
    agent: 'claude',
    disabled: false,
    caret: 0,
    resolveAttachmentOwner: () => ({ kind: 'not-ready' }),
    attachResolvedPaths: () => {},
    attachCopiedFiles: () => {},
    captureCopiedFiles: () => async () => {},
    beginPendingImageAttachment: () => null,
    resolvePendingImageAttachment: () => {},
    revealPendingImageAttachment: () => {},
    dropPendingImageAttachment: () => {},
    setNotice: () => {},
    pastesInline: () => true,
    pastedTextEditor: null
  })
  const review = useNativeChatAnnotationReview({ scopeKey, rootRef, composerRef, enabled: true })
  return (
    <TooltipProvider>
      <div ref={rootRef}>
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        {review.tray}
      </div>
    </TooltipProvider>
  )
}

beforeEach(async () => {
  localStorage.clear()
  clearNativeChatComposerDraftsForTests()
  setNativeChatComposerDraftStorageForTests(createMemoryNativeChatComposerDraftStorage())
  await hydrateNativeChatComposerDrafts()
  vi.useFakeTimers()
  getNativeChatAnnotationsStore(scopeKey).clear()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.clearAllTimers()
  vi.useRealTimers()
  clearNativeChatComposerDraftsForTests()
})

it('journals the actual composer append before removing the saved annotations, with no debounce gap', () => {
  const store = getNativeChatAnnotationsStore(scopeKey)
  store.add(anchor, 'Keep this comment after a crash.')
  render(<Harness />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Existing draft.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add annotations to message' }))
  expect(store.getSnapshot().notes).toHaveLength(0)
  expect(JSON.stringify(readNativeChatDraftJournalRecords())).toContain(
    'Keep this comment after a crash.'
  )
  const input = screen.getByRole('textbox')
  expect(input instanceof HTMLTextAreaElement && input.value).toContain('Existing draft.')
  expect(input instanceof HTMLTextAreaElement && input.value).toContain(
    'Keep this comment after a crash.'
  )
})

it('keeps the saved annotations and editor if the synchronous recovery journal fails', () => {
  const store = getNativeChatAnnotationsStore(scopeKey)
  store.add(anchor, 'Keep the source.')
  store.setEditor({ anchor, comment: 'Unfinished comment.' })
  render(<Harness />)
  const write = localStorage.setItem.bind(localStorage)
  vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
    if (key.startsWith('orca:nativeChatComposerDraftJournal:v2:entry:')) {
      throw new Error('Full')
    }
    write(key, value)
  })
  fireEvent.click(screen.getByRole('button', { name: 'Add annotations to message' }))
  expect(store.getSnapshot().notes.map((note) => note.comment)).toEqual(['Keep the source.'])
  expect(store.getSnapshot().editor?.comment).toBe('Unfinished comment.')
})
