// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createMemoryNativeChatComposerDraftStorage } from './native-chat-composer-draft-storage'

const anchor = { quote: 'Selected reply', messageId: 'reply', startOffset: 0 }
const loaded: { clear: () => void }[] = []
afterEach(() => {
  loaded.forEach((context) => context.clear())
  loaded.length = 0
  vi.restoreAllMocks()
})

async function context(storage: ReturnType<typeof createMemoryNativeChatComposerDraftStorage>) {
  vi.resetModules()
  const persistence = await import('./native-chat-composer-draft-storage')
  persistence.setNativeChatComposerDraftStorageForTests(storage)
  const store = await import('./native-chat-composer-draft-store')
  const draft = await import('./native-chat-draft-cache')
  const annotations = await import('./native-chat-annotations-store')
  loaded.push({ clear: store.clearNativeChatComposerDraftsForTests })
  await store.hydrateNativeChatComposerDrafts()
  return { store, draft, annotations }
}

it('recovers both windows transferred annotations when IndexedDB writes fail and both renderers lose memory', async () => {
  localStorage.clear()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const storage = createMemoryNativeChatComposerDraftStorage()
  const a = await context(storage)
  const b = await context(storage)
  const notesA = a.annotations.getNativeChatAnnotationsStore('review-a')
  const notesB = b.annotations.getNativeChatAnnotationsStore('review-b')
  notesA.add(anchor, 'Saved review A')
  notesB.add(anchor, 'Saved review B')
  storage.refuseWrites = true
  const write = localStorage.setItem.bind(localStorage)
  let interleaved = false
  vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
    if (!interleaved && key.startsWith('orca:nativeChatComposerDraftJournal:v2:entry:')) {
      interleaved = true
      expect(b.draft.appendNativeChatDraftCache('scope-b', 'Saved review B')).toBe(true)
      expect(notesB.consume(notesB.getSnapshot().notes)).toBe(true)
    }
    write(key, value)
  })
  expect(a.draft.appendNativeChatDraftCache('scope-a', 'Saved review A')).toBe(true)
  expect(notesA.consume(notesA.getSnapshot().notes)).toBe(true)
  expect(interleaved).toBe(true)
  expect(notesA.getSnapshot().notes).toEqual([])
  expect(notesB.getSnapshot().notes).toEqual([])
  await a.store.nativeChatComposerDraftWritesSettled()
  await b.store.nativeChatComposerDraftWritesSettled()
  expect(storage.drafts.size).toBe(0)
  a.store.clearNativeChatComposerDraftsForTests()
  b.store.clearNativeChatComposerDraftsForTests()
  const restarted = await context(storage)
  expect(restarted.draft.readNativeChatDraftCache('scope-a')).toBe('Saved review A')
  expect(restarted.draft.readNativeChatDraftCache('scope-b')).toBe('Saved review B')
  await restarted.store.nativeChatComposerDraftWritesSettled()
})
