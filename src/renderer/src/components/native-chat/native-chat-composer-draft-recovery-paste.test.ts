// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  createMemoryNativeChatComposerDraftStorage,
  type NativeChatComposerDraftStorage
} from './native-chat-composer-draft-storage'
import { mergeNativeChatComposerDraftRecovery } from './native-chat-composer-draft-recovery-merge'

const id = '12345678-1234-1234-1234-123456789abc'
const absentId = '23456789-1234-1234-1234-123456789abc'
const token = `[Pasted text](orca-paste:${id})`
const loaded: { clearNativeChatComposerDraftsForTests: () => void }[] = []
beforeEach(() => {
  localStorage.clear()
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

it.each(['restored-token', 'chosen-path', 'removed-path'] as const)(
  'preserves paste paths and admission through legacy K plus L and whole-J recovery: %s',
  async (mode) => {
    const storage = createMemoryNativeChatComposerDraftStorage()
    storage.drafts.set('scope', {
      text: `Legacy K ${token}`,
      images: [],
      savedAt: 1,
      journalEntryIds: ['k'],
      pastedTextFiles: { [id]: '/workspace/legacy.txt' }
    })
    const writer = await context(storage)
    writer.appendToNativeChatComposerDraft('scope', { text: 'Independent L' })
    await writer.nativeChatComposerDraftWritesSettled()
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
              text: mode === 'restored-token' ? 'Manual J' : `Manual J ${token}`,
              images: [],
              savedAt: at,
              editRevision: 'j',
              journalEntryIds: [],
              journalAdditions: [],
              journalAdditionsComplete: true,
              ...(mode === 'chosen-path'
                ? { pastedTextFiles: { [id]: '/workspace/chosen.txt' } }
                : {})
            }
          }
        ]
      ])
    )
    const recovered = await context(storage)
    expect(recovered.readNativeChatComposerDraft('scope').text).toContain(token)
    expect(recovered.readNativeChatComposerDraft('scope').text).toContain('Independent L')
    const expected =
      mode === 'removed-path'
        ? undefined
        : mode === 'chosen-path'
          ? '/workspace/chosen.txt'
          : '/workspace/legacy.txt'
    expect(recovered.readNativeChatComposerDraft('scope').pastedTextFiles?.[id]).toBe(expected)
    recovered.clearNativeChatComposerDraftsForTests()
    const reloaded = await context(storage)
    expect(reloaded.readNativeChatComposerDraft('scope').pastedTextFiles?.[id]).toBe(expected)
    const paste = await import('./native-chat-composer-pasted-text-references')
    expect(paste.nativeChatPastedTextAdmission('scope')).toBe(
      mode === 'removed-path' ? 'unsaved' : null
    )
  }
)

it('does not resurrect mappings for tokens not retained in the merged text', () => {
  const result = mergeNativeChatComposerDraftRecovery(
    {
      text: token,
      images: [],
      savedAt: 1,
      journalEntryIds: ['already-handled'],
      pastedTextFiles: { [id]: '/workspace/old.txt', [absentId]: '/workspace/absent.txt' }
    },
    { text: 'Chosen manual text', images: [], savedAt: 2, journalEntryIds: ['already-handled'] }
  )
  expect(result?.text).toBe('Chosen manual text')
  expect(result?.pastedTextFiles?.[id]).toBeUndefined()
  expect(result?.pastedTextFiles?.[absentId]).toBeUndefined()
})

it('keeps a mapping when an independent addition restores a token without the legacy fallback', () => {
  const result = mergeNativeChatComposerDraftRecovery(
    {
      text: token,
      images: [],
      savedAt: 1,
      journalEntryIds: ['known'],
      journalAdditions: [{ id: 'known', addition: { text: token } }],
      journalAdditionsComplete: true,
      pastedTextFiles: { [id]: '/workspace/known.txt' }
    },
    { text: 'Manual J', images: [], savedAt: 2 }
  )
  expect(result?.text).toContain(token)
  expect(result?.pastedTextFiles?.[id]).toBe('/workspace/known.txt')
})
