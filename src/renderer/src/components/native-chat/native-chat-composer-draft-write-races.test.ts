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

async function context(storage: NativeChatComposerDraftStorage, hydrate = true) {
  vi.resetModules()
  const persistence = await import('./native-chat-composer-draft-storage')
  persistence.setNativeChatComposerDraftStorageForTests(storage)
  const store = await import('./native-chat-composer-draft-store')
  loaded.push(store)
  if (hydrate) {
    await store.hydrateNativeChatComposerDrafts()
    await store.nativeChatComposerDraftWritesSettled()
  }
  return store
}

function delayedUpdates(storage: NativeChatComposerDraftStorage) {
  const pending: (() => void)[] = []
  return {
    pending,
    storage: {
      ...storage,
      update: (scope: string, apply: Parameters<NativeChatComposerDraftStorage['update']>[1]) =>
        new Promise<void>((resolve, reject) => {
          pending.push(() => {
            void storage.update(scope, apply).then(resolve, reject)
          })
        })
    }
  }
}

it('recovers both windows append text from their competing whole-draft journals without falsely sharing ids', async () => {
  const storage = createMemoryNativeChatComposerDraftStorage()
  const a = await context(storage)
  const b = await context(storage)
  vi.spyOn(Date, 'now').mockReturnValue(100)
  storage.refuseWrites = true
  expect(a.appendToNativeChatComposerDraft('scope', { text: 'Review A' })).toBe(true)
  expect(b.appendToNativeChatComposerDraft('scope', { text: 'Review B' })).toBe(true)
  await a.nativeChatComposerDraftWritesSettled()
  await b.nativeChatComposerDraftWritesSettled()
  window.dispatchEvent(new Event('pagehide'))
  await a.nativeChatComposerDraftWritesSettled()
  await b.nativeChatComposerDraftWritesSettled()
  a.clearNativeChatComposerDraftsForTests()
  b.clearNativeChatComposerDraftsForTests()
  const first = await context(storage)
  expect(first.readNativeChatComposerDraft('scope').text).toContain('Review A')
  expect(first.readNativeChatComposerDraft('scope').text).toContain('Review B')
  first.clearNativeChatComposerDraftsForTests()
  storage.refuseWrites = false
  const successful = await context(storage)
  expect(successful.readNativeChatComposerDraft('scope').text).toContain('Review A')
  expect(successful.readNativeChatComposerDraft('scope').text).toContain('Review B')
  expect(storage.drafts.get('scope')?.text).toContain('Review A')
  expect(storage.drafts.get('scope')?.text).toContain('Review B')
  expect(
    (
      await import('./native-chat-composer-draft-journal-records')
    ).readNativeChatDraftJournalRecords()
  ).toEqual([])
})

it('preserves local typing when an older append transaction commits with a later timestamp before the next append', async () => {
  const storage = createMemoryNativeChatComposerDraftStorage()
  const delayed = delayedUpdates(storage)
  const store = await context(delayed.storage)
  vi.spyOn(Date, 'now').mockReturnValue(100)
  store.appendToNativeChatComposerDraft('scope', { text: 'Review A' })
  store.updateNativeChatComposerDraft('scope', { text: 'Review A plus user x' }, 'deferred')
  const typedAt = (await import('./native-chat-composer-draft-memory')).records.get(
    'scope'
  )?.savedAt
  expect(delayed.pending).toHaveLength(1)
  delayed.pending.shift()?.()
  await store.nativeChatComposerDraftWritesSettled()
  expect(storage.drafts.get('scope')?.text).toBe('Review A')
  expect(storage.drafts.get('scope')?.savedAt).toBeGreaterThan(typedAt ?? Infinity)
  expect(store.readNativeChatComposerDraft('scope').text).toBe('Review A plus user x')
  store.appendToNativeChatComposerDraft('scope', { text: 'Review B' })
  delayed.pending.shift()?.()
  await store.nativeChatComposerDraftWritesSettled()
  expect(storage.drafts.get('scope')?.text).toBe('Review A plus user x\n\nReview B')
  expect(store.readNativeChatComposerDraft('scope').text).toBe('Review A plus user x\n\nReview B')
})

it.each(['pending', 'retry', 'pending-whole', 'retry-whole'] as const)(
  'rebases %s recovery onto a foreign append already committed and removed from its journal',
  async (mode) => {
    const storage = createMemoryNativeChatComposerDraftStorage()
    const writer = await context(storage)
    vi.resetModules()
    const journal = await import('./native-chat-composer-draft-journal')
    journal.journalNativeChatComposerDraftAddition(
      'scope',
      { text: 'Recovered J' },
      100,
      'recovery-j'
    )
    if (mode.endsWith('whole')) {
      journal.journalNativeChatComposerDraftChanges(
        new Map([
          [
            'scope',
            {
              draft: {
                text: 'Recovered J',
                images: [],
                savedAt: 100,
                journalEntryIds: ['recovery-j']
              },
              at: 100
            }
          ]
        ])
      )
    }
    const delayed = delayedUpdates(storage)
    const recovery = await context(delayed.storage, false)
    await recovery.hydrateNativeChatComposerDrafts()
    expect(delayed.pending).toHaveLength(1)
    if (mode.startsWith('retry')) {
      storage.refuseWrites = true
      delayed.pending.shift()?.()
      await recovery.nativeChatComposerDraftWritesSettled()
      storage.refuseWrites = false
    }
    expect(writer.appendToNativeChatComposerDraft('scope', { text: 'Foreign K' })).toBe(true)
    await writer.nativeChatComposerDraftWritesSettled()
    const records = await import('./native-chat-composer-draft-journal-records')
    expect(
      records
        .readNativeChatDraftJournalRecords()
        .filter(({ entry }) => 'addition' in entry)
        .map(({ entry }) => entry.id)
    ).toEqual(['recovery-j'])
    if (mode.startsWith('retry')) {
      recovery.flushNativeChatComposerDrafts()
    }
    delayed.pending.shift()?.()
    await recovery.nativeChatComposerDraftWritesSettled()
    expect(storage.drafts.get('scope')?.text).toBe('Foreign K\n\nRecovered J')
    expect(recovery.readNativeChatComposerDraft('scope').text).toBe('Foreign K\n\nRecovered J')
    expect(records.readNativeChatDraftJournalRecords()).toEqual([])
  }
)

it.each(['text', 'image'] as const)(
  'persists resolver-owned first %s additions and removes them with the owning workspace',
  async (kind) => {
    const storage = createMemoryNativeChatComposerDraftStorage()
    const store = await context(storage)
    const owner = { workspaceId: 'workspace', executionHostId: 'local' as const }
    store.setNativeChatComposerDraftOwnerResolver(() => owner)
    const cache = await import('./native-chat-draft-cache')
    if (kind === 'text') {
      cache.appendNativeChatDraftCache('scope', 'Annotation review')
    } else {
      cache.appendNativeChatAttachmentCache('scope', [
        { id: 'image', path: '/workspace/image.png' }
      ])
    }
    await store.nativeChatComposerDraftWritesSettled()
    expect(storage.drafts.get('scope')?.owner).toEqual(owner)
    expect(store.readNativeChatComposerDraft('scope').owner).toEqual(owner)
    store.clearNativeChatComposerDraftsForTests()
    const restored = await context(storage)
    expect(restored.readNativeChatComposerDraft('scope').owner).toEqual(owner)
    restored.deleteNativeChatComposerDraftsOwnedBy(owner)
    await restored.nativeChatComposerDraftWritesSettled()
    expect(storage.drafts.has('scope')).toBe(false)
  }
)
