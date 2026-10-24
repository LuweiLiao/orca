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

it.each(['v1', 'v2'] as const)(
  'recovers a newer manual whole draft without treating two missing edit revisions as equal: %s',
  async (version) => {
    const storage = createMemoryNativeChatComposerDraftStorage()
    storage.drafts.set('scope', {
      text: 'Old primary',
      images: [],
      savedAt: 1,
      journalEntryIds: []
    })
    const edited = { text: 'New manual correction', images: [], savedAt: 2, journalEntryIds: [] }
    const entry = { scopeKey: 'scope', draft: edited, at: 2, run: 'old-window' }
    localStorage.setItem(
      version === 'v1'
        ? 'orca:nativeChatComposerDraftJournal:v1'
        : 'orca:nativeChatComposerDraftJournal:v2:entry:manual',
      JSON.stringify(version === 'v1' ? [entry] : entry)
    )
    const restored = await context(storage)
    expect(restored.readNativeChatComposerDraft('scope').text).toBe('New manual correction')
    expect(storage.drafts.get('scope')?.text).toBe('New manual correction')
    restored.clearNativeChatComposerDraftsForTests()
    expect((await context(storage)).readNativeChatComposerDraft('scope').text).toBe(
      'New manual correction'
    )
  }
)

it.each(['same-edit', 'different-edit', 'legacy-whole', 'document-save'] as const)(
  'preserves foreign committed K when newer whole J rebases during recovery: %s',
  async (baseline) => {
    const storage = createMemoryNativeChatComposerDraftStorage()
    const writer = await context(storage)
    vi.spyOn(Date, 'now').mockReturnValue(100)
    writer.updateNativeChatComposerDraft('scope', { text: 'Original manual draft' }, 'immediate')
    await writer.nativeChatComposerDraftWritesSettled()
    const initial = storage.drafts.get('scope')
    if (!initial) {
      throw new Error('Missing primary')
    }
    vi.resetModules()
    const journal = await import('./native-chat-composer-draft-journal')
    const j: StoredNativeChatComposerDraft = {
      ...initial,
      text: 'Recovered J',
      savedAt: 1000,
      journalEntryIds: ['recovery-j'],
      ...(baseline === 'different-edit' ? { editRevision: 'new-edit-j' } : {})
    }
    const whole = baseline === 'legacy-whole' ? { ...j, editRevision: undefined } : j
    journal.journalNativeChatComposerDraftAddition(
      'scope',
      { text: 'Recovered J' },
      1000,
      'recovery-j'
    )
    journal.journalNativeChatComposerDraftChanges(new Map([['scope', { draft: whole, at: 1000 }]]))
    const pending: (() => void)[] = []
    const delayed = {
      ...storage,
      update: (scope: string, apply: Parameters<NativeChatComposerDraftStorage['update']>[1]) =>
        new Promise<void>((resolve, reject) => {
          pending.push(() => {
            void storage.update(scope, apply).then(resolve, reject)
          })
        })
    }
    const recovery = await context(delayed, false)
    await recovery.hydrateNativeChatComposerDrafts()
    expect(pending).toHaveLength(1)
    if (baseline === 'different-edit') {
      writer.updateNativeChatComposerDraft('scope', { text: 'Foreign manual edit' }, 'immediate')
      await writer.nativeChatComposerDraftWritesSettled()
    }
    expect(writer.appendToNativeChatComposerDraft('scope', { text: 'Durable foreign K' })).toBe(
      true
    )
    await writer.nativeChatComposerDraftWritesSettled()
    expect(storage.drafts.get('scope')?.savedAt).toBeLessThan(1000)
    expect(storage.drafts.get('scope')?.text).toContain('Durable foreign K')
    if (baseline === 'document-save') {
      writer.updateNativeChatComposerDraft(
        'scope',
        { document: { type: 'doc', content: [] } },
        'immediate'
      )
      await writer.nativeChatComposerDraftWritesSettled()
    }
    const records = await import('./native-chat-composer-draft-journal-records')
    expect(
      records
        .readNativeChatDraftJournalRecords()
        .filter(({ entry }) => 'addition' in entry)
        .map(({ entry }) => entry.id)
    ).toEqual(['recovery-j'])
    pending.shift()?.()
    await recovery.nativeChatComposerDraftWritesSettled()
    expect(recovery.readNativeChatComposerDraft('scope').text).toContain('Recovered J')
    expect(recovery.readNativeChatComposerDraft('scope').text).toContain('Durable foreign K')
    expect(storage.drafts.get('scope')?.text).toContain('Durable foreign K')
    expect(storage.drafts.get('scope')?.text).toContain('Recovered J')
    expect(records.readNativeChatDraftJournalRecords()).toEqual([])
    writer.clearNativeChatComposerDraftsForTests()
    recovery.clearNativeChatComposerDraftsForTests()
    const next = await context(storage)
    expect(next.readNativeChatComposerDraft('scope').text).toContain('Durable foreign K')
    expect(next.readNativeChatComposerDraft('scope').text).toContain('Recovered J')
  }
)

it.each([
  { kind: 'text', host: 'local' },
  { kind: 'image', host: 'local' },
  { kind: 'text', host: 'runtime:server' }
] as const)(
  'recovers owner from the acknowledged $kind addition on $host after a crash without pagehide',
  async ({ kind, host }) => {
    const storage = createMemoryNativeChatComposerDraftStorage()
    const writer = await context(storage)
    const owner = { workspaceId: 'owned-workspace', executionHostId: host }
    writer.setNativeChatComposerDraftOwnerResolver(() => owner)
    storage.refuseWrites = true
    expect(
      writer.appendToNativeChatComposerDraft(
        'scope',
        kind === 'text'
          ? { text: 'Owned annotation' }
          : { images: [{ id: 'image', path: '/workspace/saved.png' }] }
      )
    ).toBe(true)
    await writer.nativeChatComposerDraftWritesSettled()
    expect(storage.drafts.size).toBe(0)
    const records = await import('./native-chat-composer-draft-journal-records')
    expect(records.readNativeChatDraftJournalRecords()).toHaveLength(1)
    expect(records.readNativeChatDraftJournalRecords()[0]?.entry).toMatchObject({ owner })
    writer.clearNativeChatComposerDraftsForTests()
    storage.refuseWrites = false
    const restored = await context(storage)
    expect(restored.readNativeChatComposerDraft('scope').owner).toEqual(owner)
    expect(storage.drafts.get('scope')?.owner).toEqual(owner)
    restored.deleteNativeChatComposerDraftsOwnedBy(owner)
    await restored.nativeChatComposerDraftWritesSettled()
    expect(storage.drafts.has('scope')).toBe(false)
  }
)

it('preserves both texts when an older confirmed primary has ids but no recoverable addition metadata', async () => {
  const storage = createMemoryNativeChatComposerDraftStorage()
  storage.drafts.set('scope', {
    text: 'Old-format durable K',
    images: [],
    savedAt: 1,
    journalEntryIds: ['old-k'],
    editRevision: 'edit-k'
  })
  localStorage.setItem(
    'orca:nativeChatComposerDraftJournal:v2:entry:j',
    JSON.stringify({
      scopeKey: 'scope',
      at: 2,
      run: 'old-j',
      draft: {
        text: 'Manual J',
        images: [],
        savedAt: 2,
        journalEntryIds: [],
        editRevision: 'edit-j'
      }
    })
  )
  const recovered = await context(storage)
  expect(recovered.readNativeChatComposerDraft('scope').text).toContain('Old-format durable K')
  expect(recovered.readNativeChatComposerDraft('scope').text).toContain('Manual J')
})

it('does not restore addition text that was already replaced by a manual edit', async () => {
  const storage = createMemoryNativeChatComposerDraftStorage()
  const writer = await context(storage)
  writer.appendToNativeChatComposerDraft('scope', { text: 'Append removed by the user' })
  await writer.nativeChatComposerDraftWritesSettled()
  writer.updateNativeChatComposerDraft('scope', { text: 'Current manual draft' }, 'immediate')
  await writer.nativeChatComposerDraftWritesSettled()
  expect(storage.drafts.get('scope')?.journalAdditions).toEqual([])
  const current = storage.drafts.get('scope')
  writer.clearNativeChatComposerDraftsForTests()
  localStorage.setItem(
    'orca:nativeChatComposerDraftJournal:v2:entry:new-edit',
    JSON.stringify({
      scopeKey: 'scope',
      at: (current?.savedAt ?? 0) + 1,
      draft: {
        text: 'Newer manual draft',
        images: [],
        savedAt: (current?.savedAt ?? 0) + 1,
        journalEntryIds: [],
        journalAdditions: [],
        editRevision: 'new-edit'
      },
      run: 'other'
    })
  )
  const restored = await context(storage)
  expect(restored.readNativeChatComposerDraft('scope').text).toBe('Newer manual draft')
})
