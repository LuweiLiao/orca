// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  createMemoryNativeChatComposerDraftStorage,
  type NativeChatComposerDraftStorage,
  type StoredNativeChatComposerDraft
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

async function journal() {
  vi.resetModules()
  return import('./native-chat-composer-draft-journal')
}

async function reload(storage: NativeChatComposerDraftStorage) {
  vi.resetModules()
  const persistence = await import('./native-chat-composer-draft-storage')
  persistence.setNativeChatComposerDraftStorageForTests(storage)
  const store = await import('./native-chat-composer-draft-store')
  loaded.push(store)
  await store.hydrateNativeChatComposerDrafts()
  await store.nativeChatComposerDraftWritesSettled()
  return store
}

it('waits for both the transactional append and deferred edit to commit, and reports refusal', async () => {
  const storage = createMemoryNativeChatComposerDraftStorage()
  const pending: (() => void)[] = []
  const slow = {
    ...storage,
    write: (scope: string, draft: StoredNativeChatComposerDraft) =>
      new Promise<void>((resolve) => {
        pending.push(() => {
          storage.drafts.set(scope, draft)
          resolve()
        })
      }),
    update: (scope: string, apply: Parameters<NativeChatComposerDraftStorage['update']>[1]) =>
      new Promise<void>((resolve) => {
        pending.push(() => {
          void storage.update(scope, apply).then(resolve)
        })
      })
  }
  const store = await reload(slow)
  store.appendToNativeChatComposerDraft('scope', { text: 'returned by Stop' })
  store.updateNativeChatComposerDraft('scope', { text: 'returned by Stop, edited' }, 'deferred')
  let settled: boolean | undefined
  void store.nativeChatComposerDraftWriteSettled('scope').then((value) => {
    settled = value
  })
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(settled).toBeUndefined()
  expect(pending).toHaveLength(2)
  pending.shift()?.()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(settled).toBeUndefined()
  pending.shift()?.()
  await vi.waitFor(() => expect(settled).toBe(true))
  store.clearNativeChatComposerDraftsForTests()
  const refusing = await reload(storage)
  storage.refuseWrites = true
  refusing.appendToNativeChatComposerDraft('refused', { text: 'returned' })
  await expect(refusing.nativeChatComposerDraftWriteSettled('refused')).resolves.toBe(false)
})

it('keeps both recovery records until a recovered whole draft is actually committed, across two failed startups', async () => {
  const writer = await journal()
  expect(
    writer.journalNativeChatComposerDraftAddition('scope', { text: 'Saved annotation' }, 100)
  ).toBe(true)
  writer.journalNativeChatComposerDraftChanges(
    new Map([['scope', { draft: { text: 'Saved annotation', images: [], savedAt: 100 }, at: 100 }]])
  )
  const storage = createMemoryNativeChatComposerDraftStorage()
  storage.refuseWrites = true
  const first = await reload(storage)
  expect(first.readNativeChatComposerDraft('scope').text).toBe('Saved annotation')
  expect(storage.drafts.size).toBe(0)
  const records = await import('./native-chat-composer-draft-journal-records')
  expect(records.readNativeChatDraftJournalRecords()).toHaveLength(2)
  first.clearNativeChatComposerDraftsForTests()
  const second = await reload(storage)
  expect(second.readNativeChatComposerDraft('scope').text).toBe('Saved annotation')
  expect(records.readNativeChatDraftJournalRecords()).toHaveLength(2)
  second.clearNativeChatComposerDraftsForTests()
  storage.refuseWrites = false
  const successful = await reload(storage)
  expect(successful.readNativeChatComposerDraft('scope').text).toBe('Saved annotation')
  expect(storage.drafts.get('scope')?.text).toBe('Saved annotation')
  expect(records.readNativeChatDraftJournalRecords()).toEqual([])
})

it('replays two independently acknowledged same-scope appends at the same timestamp exactly once', async () => {
  const a = await journal()
  const b = await journal()
  expect(a.journalNativeChatComposerDraftAddition('scope', { text: 'First review' }, 100)).toBe(
    true
  )
  expect(b.journalNativeChatComposerDraftAddition('scope', { text: 'Second review' }, 100)).toBe(
    true
  )
  const fresh = await journal()
  const drafts = new Map<string, StoredNativeChatComposerDraft | null>()
  const snapshot = fresh.snapshotNativeChatComposerDraftJournal()
  fresh.replayNativeChatComposerDraftJournal(drafts, snapshot)
  expect(drafts.get('scope')?.text).toBe('First review\n\nSecond review')
  expect(drafts.get('scope')?.journalEntryIds).toHaveLength(2)
  const records = await import('./native-chat-composer-draft-journal-records')
  expect(records.readNativeChatDraftJournalRecords()).toHaveLength(2)
  const storage = createMemoryNativeChatComposerDraftStorage()
  const restored = await reload(storage)
  expect(restored.readNativeChatComposerDraft('scope').text).toBe('First review\n\nSecond review')
  expect(storage.drafts.get('scope')?.text).toBe('First review\n\nSecond review')
  restored.clearNativeChatComposerDraftsForTests()
  const again = await reload(storage)
  expect(again.readNativeChatComposerDraft('scope').text).toBe('First review\n\nSecond review')
  expect(records.readNativeChatDraftJournalRecords()).toEqual([])
})

it('does not skip an unconfirmed append merely because a confirmed different record has an equal or later timestamp', async () => {
  const a = await journal()
  const b = await journal()
  a.journalNativeChatComposerDraftAddition('scope', { text: 'First review' }, 101, 'first')
  b.journalNativeChatComposerDraftAddition('scope', { text: 'Second review' }, 100, 'second')
  const storage = createMemoryNativeChatComposerDraftStorage()
  storage.drafts.set('scope', {
    text: 'First review',
    images: [],
    savedAt: 101,
    journalEntryIds: ['first']
  })
  const restored = await reload(storage)
  expect(restored.readNativeChatComposerDraft('scope').text).toBe('First review\n\nSecond review')
  expect(storage.drafts.get('scope')?.journalEntryIds).toEqual(['first', 'second'])
})

it('retains an unconfirmed foreign append when another window confirms an equal-time different append', async () => {
  const storage = createMemoryNativeChatComposerDraftStorage()
  const writer = await reload(storage)
  const a = await import('./native-chat-draft-cache')
  const b = await journal()
  b.journalNativeChatComposerDraftAddition(
    'scope',
    { text: 'Foreign review' },
    Date.now(),
    'foreign'
  )
  a.appendNativeChatDraftCache('scope', 'Confirmed review')
  await writer.nativeChatComposerDraftWritesSettled()
  const records = await import('./native-chat-composer-draft-journal-records')
  expect(records.readNativeChatDraftJournalRecords().map(({ entry }) => entry.id)).toEqual([
    'foreign'
  ])
  writer.clearNativeChatComposerDraftsForTests()
  const restored = await reload(storage)
  expect(restored.readNativeChatComposerDraft('scope').text).toBe(
    'Confirmed review\n\nForeign review'
  )
})

it('recovers two real draft-store appends from the same millisecond after repeated failed recovery writes', async () => {
  const storage = createMemoryNativeChatComposerDraftStorage()
  const a = await reload(storage)
  const b = await reload(storage)
  vi.spyOn(Date, 'now').mockReturnValue(100)
  storage.refuseWrites = true
  expect(a.appendToNativeChatComposerDraft('scope', { text: 'First review' })).toBe(true)
  expect(b.appendToNativeChatComposerDraft('scope', { text: 'Second review' })).toBe(true)
  await a.nativeChatComposerDraftWritesSettled()
  await b.nativeChatComposerDraftWritesSettled()
  const records = await import('./native-chat-composer-draft-journal-records')
  expect(records.readNativeChatDraftJournalRecords().map(({ entry }) => entry.at)).toEqual([
    100, 100
  ])
  a.clearNativeChatComposerDraftsForTests()
  b.clearNativeChatComposerDraftsForTests()
  const first = await reload(storage)
  expect(first.readNativeChatComposerDraft('scope').text).toBe('First review\n\nSecond review')
  first.clearNativeChatComposerDraftsForTests()
  const second = await reload(storage)
  expect(second.readNativeChatComposerDraft('scope').text).toBe('First review\n\nSecond review')
  expect(storage.drafts.size).toBe(0)
  expect(records.readNativeChatDraftJournalRecords()).toHaveLength(2)
})

it('does not replay committed additions twice when confirmation cleanup fails and text was edited since', async () => {
  const storage = createMemoryNativeChatComposerDraftStorage()
  const writer = await reload(storage)
  const blocked = vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {
    throw new Error('Cleanup refused')
  })
  writer.appendToNativeChatComposerDraft('scope', { text: 'Returned review' })
  await writer.nativeChatComposerDraftWritesSettled()
  writer.updateNativeChatComposerDraft(
    'scope',
    { text: 'User replaced the returned text.' },
    'immediate'
  )
  await writer.nativeChatComposerDraftWritesSettled()
  blocked.mockRestore()
  writer.clearNativeChatComposerDraftsForTests()
  const restored = await reload(storage)
  expect(restored.readNativeChatComposerDraft('scope').text).toBe(
    'User replaced the returned text.'
  )
  expect(
    (
      await import('./native-chat-composer-draft-journal-records')
    ).readNativeChatDraftJournalRecords()
  ).toEqual([])
})

it('commits two live windows independent same-scope additions without replacing the other confirmed text', async () => {
  const storage = createMemoryNativeChatComposerDraftStorage()
  const a = await reload(storage)
  const b = await reload(storage)
  vi.spyOn(Date, 'now').mockReturnValue(100)
  expect(a.appendToNativeChatComposerDraft('scope', { text: 'First review' })).toBe(true)
  expect(b.appendToNativeChatComposerDraft('scope', { text: 'Second review' })).toBe(true)
  await a.nativeChatComposerDraftWritesSettled()
  await b.nativeChatComposerDraftWritesSettled()
  a.clearNativeChatComposerDraftsForTests()
  b.clearNativeChatComposerDraftsForTests()
  const restored = await reload(storage)
  expect(restored.readNativeChatComposerDraft('scope').text).toBe('First review\n\nSecond review')
})

it('uses immutable keys as identities for older v2 records without explicit ids', async () => {
  localStorage.setItem(
    'orca:nativeChatComposerDraftJournal:v2:entry:first',
    JSON.stringify({ scopeKey: 'scope', run: 'old-a', at: 100, addition: { text: 'First review' } })
  )
  localStorage.setItem(
    'orca:nativeChatComposerDraftJournal:v2:entry:second',
    JSON.stringify({
      scopeKey: 'scope',
      run: 'old-b',
      at: 100,
      addition: { text: 'Second review' }
    })
  )
  const storage = createMemoryNativeChatComposerDraftStorage()
  storage.drafts.set('scope', { text: 'First review', images: [], savedAt: 100 })
  const restored = await reload(storage)
  expect(restored.readNativeChatComposerDraft('scope').text).toBe('First review\n\nSecond review')
})
