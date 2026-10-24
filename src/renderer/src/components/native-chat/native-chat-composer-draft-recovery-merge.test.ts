import { expect, it } from 'vitest'
import {
  addNativeChatComposerDraftJournalAddition,
  mergeNativeChatComposerDraftRecovery
} from './native-chat-composer-draft-recovery-merge'
import {
  parseStoredNativeChatComposerDraft,
  type StoredNativeChatComposerDraft
} from './native-chat-composer-draft-storage'
import { savedNativeChatComposerDraft } from './native-chat-composer-draft-saved-form'

it('repeated recovery merges independent additions once, without replacing a newer manual baseline', () => {
  const base = {
    text: 'Initial',
    images: [],
    savedAt: 1,
    journalAdditions: [],
    journalEntryIds: [],
    editRevision: 'initial'
  }
  const foreign = addNativeChatComposerDraftJournalAddition(base, { text: 'Foreign K' }, 'foreign')
  const recovered = {
    text: 'Manual J',
    images: [],
    savedAt: 2,
    journalEntryIds: [],
    journalAdditions: [],
    editRevision: 'manual'
  }
  const merged = mergeNativeChatComposerDraftRecovery(foreign, recovered)
  expect(merged?.text).toBe('Manual J\n\nForeign K')
  expect(mergeNativeChatComposerDraftRecovery(foreign, merged)).toEqual(merged)
})

it('retains legacy unknown text even when both drafts reference an image already held', () => {
  const image = { id: 'shared', path: '/workspace/shared.png' }
  const previous = { text: 'Old K', images: [image], savedAt: 1, journalEntryIds: ['unknown'] }
  const recovered = { text: 'Manual J', images: [image], savedAt: 2, journalEntryIds: [] }
  const result = mergeNativeChatComposerDraftRecovery(previous, recovered)
  expect(result?.text).toBe('Manual J\n\nOld K')
  expect(result?.images).toEqual([image])
})

it('parses and merges persisted unavailable attachments as placeholders without restoring an external paste path', () => {
  const foreign = addNativeChatComposerDraftJournalAddition(
    { text: '', images: [], savedAt: 1 },
    { images: [{ id: 'image', path: '/tmp/clipboard.png' }] },
    'image'
  )
  // The saved record already contains the placeholder form chosen by the attachment policy.
  const saved: StoredNativeChatComposerDraft = {
    ...foreign,
    images: [{ id: 'image', path: '', unavailableName: 'clipboard.png' }],
    journalAdditions: [
      {
        id: 'image',
        addition: { images: [{ id: 'image', path: '', unavailableName: 'clipboard.png' }] }
      }
    ]
  }
  const parsed = parseStoredNativeChatComposerDraft(JSON.parse(JSON.stringify(saved)))
  expect(parsed?.journalAdditions?.[0].addition.images?.[0].unavailableName).toBe('clipboard.png')
  const merged = mergeNativeChatComposerDraftRecovery(parsed, {
    text: 'Manual J',
    images: [],
    savedAt: 2
  })
  expect(merged?.images).toEqual([{ id: 'image', path: '', unavailableName: 'clipboard.png' }])
  expect(savedNativeChatComposerDraft(merged ?? saved)?.images).toEqual(saved.images)
})

it('keeps the selected draft owner and inherits it only when absent', () => {
  const previous = {
    text: 'K',
    images: [],
    savedAt: 1,
    owner: { workspaceId: 'first', executionHostId: 'local' as const }
  }
  const recovered = { text: 'J', images: [], savedAt: 2 }
  expect(mergeNativeChatComposerDraftRecovery(previous, recovered)?.owner).toEqual(previous.owner)
  const owner = { workspaceId: 'selected', executionHostId: 'runtime:server' as const }
  expect(mergeNativeChatComposerDraftRecovery(previous, { ...recovered, owner })?.owner).toEqual(
    owner
  )
})
