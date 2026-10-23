// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { StoredNativeChatComposerDraft } from './native-chat-composer-draft-storage'

const prefix = 'orca:nativeChatComposerDraftJournal:v2:entry:'
beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

async function context() {
  vi.resetModules()
  return import('./native-chat-composer-draft-journal')
}

async function recovered() {
  const fresh = await context()
  const drafts = new Map<string, StoredNativeChatComposerDraft | null>()
  fresh.replayNativeChatComposerDraftJournal(drafts, fresh.snapshotNativeChatComposerDraftJournal())
  return drafts
}

it('recovers both acknowledged additions when two contexts write from overlapping snapshots', async () => {
  const a = await context()
  const b = await context()
  const write = localStorage.setItem.bind(localStorage)
  let interleaved = false
  vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
    if (!interleaved && key.startsWith(prefix)) {
      interleaved = true
      expect(b.journalNativeChatComposerDraftAddition('scope-b', { text: 'Review B' }, 2)).toBe(
        true
      )
    }
    write(key, value)
  })
  expect(a.journalNativeChatComposerDraftAddition('scope-a', { text: 'Review A' }, 1)).toBe(true)
  expect(interleaved).toBe(true)
  const drafts = await recovered()
  expect(drafts.get('scope-a')?.text).toBe('Review A')
  expect(drafts.get('scope-b')?.text).toBe('Review B')
})

it.each(['append-first', 'whole-first'] as const)(
  'keeps whole drafts and additions across concurrent writers: %s',
  async (order) => {
    const a = await context()
    const b = await context()
    const write = localStorage.setItem.bind(localStorage)
    let interleaved = false
    const whole = () =>
      b.journalNativeChatComposerDraftChanges(
        new Map([
          ['whole', { draft: { text: 'Typed before closing', images: [], savedAt: 2 }, at: 2 }]
        ])
      )
    vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
      if (!interleaved && key.startsWith(prefix)) {
        interleaved = true
        if (order === 'append-first') {
          whole()
        } else {
          expect(
            a.journalNativeChatComposerDraftAddition('append', { text: 'Returned review' }, 3)
          ).toBe(true)
        }
      }
      write(key, value)
    })
    if (order === 'append-first') {
      expect(
        a.journalNativeChatComposerDraftAddition('append', { text: 'Returned review' }, 3)
      ).toBe(true)
    } else {
      whole()
    }
    const drafts = await recovered()
    expect(drafts.get('whole')?.text).toBe('Typed before closing')
    expect(drafts.get('append')?.text).toBe('Returned review')
  }
)

it('a prune removes only immutable keys it observed and cannot remove a concurrent addition', async () => {
  const a = await context()
  const b = await context()
  a.journalNativeChatComposerDraftAddition('confirmed', { text: 'Already saved' }, 1)
  const remove = localStorage.removeItem.bind(localStorage)
  let interleaved = false
  vi.spyOn(localStorage, 'removeItem').mockImplementation((key) => {
    if (!interleaved && key.startsWith(prefix)) {
      interleaved = true
      expect(b.journalNativeChatComposerDraftAddition('other', { text: 'Still pending' }, 2)).toBe(
        true
      )
      expect(
        b.journalNativeChatComposerDraftAddition('confirmed', { text: 'New same-scope record' }, 1)
      ).toBe(true)
    }
    remove(key)
  })
  a.pruneNativeChatComposerDraftJournal('confirmed', 1)
  const drafts = await recovered()
  expect(interleaved).toBe(true)
  expect(drafts.get('other')?.text).toBe('Still pending')
  expect(drafts.get('confirmed')?.text).toBe('New same-scope record')
})

it('a confirmation occurring before an append lands cannot erase its recovery record', async () => {
  const a = await context()
  const b = await context()
  a.journalNativeChatComposerDraftAddition('confirmed', { text: 'Already saved' }, 1)
  const write = localStorage.setItem.bind(localStorage)
  let interleaved = false
  vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
    if (!interleaved && key.startsWith(prefix)) {
      interleaved = true
      b.pruneNativeChatComposerDraftJournal('confirmed', 3)
    }
    write(key, value)
  })
  expect(a.journalNativeChatComposerDraftAddition('pending', { text: 'Keep after prune' }, 2)).toBe(
    true
  )
  const drafts = await recovered()
  expect(drafts.has('confirmed')).toBe(false)
  expect(drafts.get('pending')?.text).toBe('Keep after prune')
})

it('reads and retires legacy entries without rewriting a competing legacy journal writer', async () => {
  const key = 'orca:nativeChatComposerDraftJournal:v1'
  const old = { scopeKey: 'old', at: 1, run: 'legacy', addition: { text: 'Old journal' } }
  const next = { scopeKey: 'other', at: 2, run: 'legacy', addition: { text: 'New legacy write' } }
  localStorage.setItem(key, JSON.stringify([old]))
  const a = await context()
  const write = localStorage.setItem.bind(localStorage)
  let interleaved = false
  vi.spyOn(localStorage, 'setItem').mockImplementation((candidate, value) => {
    if (!interleaved && candidate.includes(':legacy-pruned:')) {
      interleaved = true
      write(key, JSON.stringify([old, next]))
    }
    write(candidate, value)
  })
  a.pruneNativeChatComposerDraftJournal('old', 1)
  const drafts = await recovered()
  expect(interleaved).toBe(true)
  expect(drafts.has('old')).toBe(false)
  expect(drafts.get('other')?.text).toBe('New legacy write')
})

it('failed pruning retains recovery entries for the next load', async () => {
  const a = await context()
  a.journalNativeChatComposerDraftAddition('pending', { text: 'Keep on cleanup failure' }, 1)
  const blocked = vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {
    throw new Error('Blocked')
  })
  a.pruneNativeChatComposerDraftJournal('pending', 1)
  blocked.mockRestore()
  expect((await recovered()).get('pending')?.text).toBe('Keep on cleanup failure')
})

it('corrupt legacy JSON does not hide an independent acknowledged record', async () => {
  const a = await context()
  localStorage.setItem('orca:nativeChatComposerDraftJournal:v1', '{broken')
  expect(
    a.journalNativeChatComposerDraftAddition('pending', { text: 'Saved independently' }, 1)
  ).toBe(true)
  expect((await recovered()).get('pending')?.text).toBe('Saved independently')
})

it('replaces only its own older whole drafts after saving the new one', async () => {
  const a = await context()
  const b = await context()
  const changes = (text: string, at: number) =>
    new Map([['whole', { draft: { text, images: [], savedAt: at }, at }]])
  a.journalNativeChatComposerDraftChanges(changes('First', 1))
  b.journalNativeChatComposerDraftAddition('other', { text: 'Other window' }, 2)
  a.journalNativeChatComposerDraftChanges(changes('Second', 3))
  a.journalNativeChatComposerDraftChanges(changes('Second', 3))
  const records = (
    await import('./native-chat-composer-draft-journal-records')
  ).readNativeChatDraftJournalRecords()
  expect(records.filter(({ entry }) => entry.scopeKey === 'whole')).toHaveLength(1)
  const drafts = await recovered()
  expect(drafts.get('whole')?.text).toBe('Second')
  expect(drafts.get('other')?.text).toBe('Other window')
})

it('retains the last whole draft if saving its replacement fails', async () => {
  const a = await context()
  a.journalNativeChatComposerDraftChanges(
    new Map([['whole', { draft: { text: 'Last saved', images: [], savedAt: 1 }, at: 1 }]])
  )
  const blocked = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
    throw new Error('Full')
  })
  a.journalNativeChatComposerDraftChanges(
    new Map([['whole', { draft: { text: 'Refused replacement', images: [], savedAt: 2 }, at: 2 }]])
  )
  blocked.mockRestore()
  expect((await recovered()).get('whole')?.text).toBe('Last saved')
})
