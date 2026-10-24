// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  createMemoryNativeChatComposerDraftStorage,
  type NativeChatComposerDraftStorage
} from './native-chat-composer-draft-storage'

const loaded: { clearNativeChatComposerDraftsForTests: () => void }[] = []
beforeEach(() => {
  localStorage.clear()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  loaded.splice(0).forEach((store) => store.clearNativeChatComposerDraftsForTests())
  vi.restoreAllMocks()
})

async function context(storage: NativeChatComposerDraftStorage) {
  vi.resetModules()
  const persistence = await import('./native-chat-composer-draft-storage')
  persistence.setNativeChatComposerDraftStorageForTests(storage)
  const store = await import('./native-chat-composer-draft-store')
  loaded.push(store)
  await store.hydrateNativeChatComposerDrafts()
  await store.nativeChatComposerDraftWritesSettled()
  return store
}

it.each(['old-primary', 'partial-primary'] as const)(
  'keeps legacy K with newer L additions through recovery of whole J: %s',
  async (format) => {
    const storage = createMemoryNativeChatComposerDraftStorage()
    storage.drafts.set('scope', {
      text: 'Durable legacy K',
      images: [],
      savedAt: 10,
      journalEntryIds: ['legacy-k']
    })
    const writer = await context(storage)
    expect(writer.appendToNativeChatComposerDraft('scope', { text: 'New independent L' })).toBe(
      true
    )
    await writer.nativeChatComposerDraftWritesSettled()
    if (format === 'partial-primary') {
      const held = storage.drafts.get('scope')
      if (!held) {
        throw new Error('No draft')
      }
      // The previous build stored a partial array without an explicit coverage flag.
      storage.drafts.set('scope', {
        text: held.text,
        images: held.images,
        savedAt: held.savedAt,
        journalEntryIds: held.journalEntryIds,
        journalAdditions: held.journalAdditions
      })
    }
    writer.clearNativeChatComposerDraftsForTests()
    vi.resetModules()
    const journal = await import('./native-chat-composer-draft-journal')
    const at = Date.now() + 10000
    journal.journalNativeChatComposerDraftChanges(
      new Map([
        [
          'scope',
          {
            at,
            draft: {
              text: 'Recovered whole J',
              images: [],
              savedAt: at,
              editRevision: 'j-edit',
              journalEntryIds: ['j'],
              journalAdditions: [{ id: 'j', addition: { text: 'Recovered whole J' } }]
            }
          }
        ]
      ])
    )
    const recovered = await context(storage)
    const text = recovered.readNativeChatComposerDraft('scope').text
    expect(text).toContain('Recovered whole J')
    expect(text).toContain('New independent L')
    expect(text).toContain('Durable legacy K')
    recovered.clearNativeChatComposerDraftsForTests()
    expect((await context(storage)).readNativeChatComposerDraft('scope').text).toBe(text)
  }
)

const tokenId = '12345678-1234-1234-1234-123456789abc'
const text = `[Pasted text](orca-paste:${tokenId})`
const document = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text, marks: [{ type: 'bold' }] }] }]
}

it('keeps metadata changes when a refused append is retried together with a later addition', async () => {
  const storage = createMemoryNativeChatComposerDraftStorage()
  const store = await context(storage)
  storage.refuseWrites = true
  store.appendToNativeChatComposerDraft('scope', { text })
  await store.nativeChatComposerDraftWritesSettled()
  store.updateNativeChatComposerDraft(
    'scope',
    { document, pastedTextFiles: { [tokenId]: '/workspace/pasted.txt' } },
    'deferred'
  )
  store.flushNativeChatComposerDrafts()
  await store.nativeChatComposerDraftWritesSettled()
  storage.refuseWrites = false
  store.appendToNativeChatComposerDraft('scope', { text: 'Later addition' })
  await store.nativeChatComposerDraftWritesSettled()
  const held = storage.drafts.get('scope')
  expect(held?.text).toContain('Later addition')
  expect(held?.document?.content?.[0]?.content?.[0]?.marks).toEqual([{ type: 'bold' }])
  expect(held?.pastedTextFiles?.[tokenId]).toBe('/workspace/pasted.txt')
  store.clearNativeChatComposerDraftsForTests()
  const restored = await context(storage)
  expect(restored.readNativeChatComposerDraft('scope').document).toEqual(held?.document)
  expect(restored.readNativeChatComposerDraft('scope').pastedTextFiles).toEqual(
    held?.pastedTextFiles
  )
})

it.each([
  'append-document',
  'append-path',
  'append-both',
  'recovery-document',
  'recovery-path',
  'recovery-both'
] as const)(
  'retains metadata added after a refused transaction during retry and reload: %s',
  async (mode) => {
    const storage = createMemoryNativeChatComposerDraftStorage()
    if (mode.startsWith('recovery')) {
      vi.resetModules()
      const journal = await import('./native-chat-composer-draft-journal')
      journal.journalNativeChatComposerDraftAddition('scope', { text }, 100, 'recovery')
    }
    storage.refuseWrites = true
    const store = await context(storage)
    if (mode.startsWith('append')) {
      expect(store.appendToNativeChatComposerDraft('scope', { text })).toBe(true)
      await store.nativeChatComposerDraftWritesSettled()
    }
    expect(storage.drafts.size).toBe(0)
    const paths = { [tokenId]: '/workspace/pasted.txt' }
    store.updateNativeChatComposerDraft(
      'scope',
      {
        ...(mode.endsWith('document') || mode.endsWith('both') ? { document } : {}),
        ...(mode.endsWith('path') || mode.endsWith('both') ? { pastedTextFiles: paths } : {})
      },
      'deferred'
    )
    storage.refuseWrites = false
    store.flushNativeChatComposerDrafts()
    await store.nativeChatComposerDraftWritesSettled()
    const assert = (draft: ReturnType<typeof store.readNativeChatComposerDraft>) => {
      if (mode.endsWith('document') || mode.endsWith('both')) {
        expect(draft.document).toEqual(document)
      }
      if (mode.endsWith('path') || mode.endsWith('both')) {
        expect(draft.pastedTextFiles).toEqual(paths)
      }
    }
    assert(store.readNativeChatComposerDraft('scope'))
    store.clearNativeChatComposerDraftsForTests()
    assert((await context(storage)).readNativeChatComposerDraft('scope'))
  }
)
