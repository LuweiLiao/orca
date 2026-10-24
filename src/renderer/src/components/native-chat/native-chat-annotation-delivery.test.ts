// @vitest-environment happy-dom
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { AgentJournalSubmission } from '../../../../shared/agent-session-journal-types'

let scope = ''
let scopeIndex = 0
const anchor = { messageId: 'reply', quote: 'Selected passage.', startOffset: 0 }

beforeEach(() => {
  scope = `annotation-delivery-${++scopeIndex}`
  localStorage.clear()
  vi.resetModules()
})
afterEach(() => vi.restoreAllMocks())

async function open() {
  const { getNativeChatAnnotationsStore, prepareNativeChatAnnotatedMessage } =
    await import('./native-chat-annotations-store')
  const { reconcileNativeChatAnnotationDeliveries, useNativeChatAnnotationDelivery } =
    await import('./use-native-chat-annotation-delivery')
  const { nativeChatAnnotationStorage } = await import('./native-chat-annotation-storage')
  return {
    store: getNativeChatAnnotationsStore(scope),
    prepare: (text = '') => prepareNativeChatAnnotatedMessage(scope, text),
    reconcile: (
      submissions: AgentJournalSubmission[],
      cards: { messageId: string; state: 'waiting' | 'returned' }[] = []
    ) => reconcileNativeChatAnnotationDeliveries(scope, { submissions, cards }),
    stored: nativeChatAnnotationStorage(scope),
    useDelivery: useNativeChatAnnotationDelivery
  }
}

function submission(
  dispatchState: AgentJournalSubmission['dispatchState'],
  fields: Partial<AgentJournalSubmission> = {}
): AgentJournalSubmission {
  return {
    clientMessageId: 'provider-send',
    fence: 1,
    payloadFingerprint: 'sent',
    dispatchState,
    providerItemId: null,
    reason: null,
    submittedAt: 1,
    resolvedAt: 2,
    queuedMessageId: 'queue-send',
    ...fields
  }
}

it('restores editable anchors and an unfinished editor when a queue returns after renderer reload', async () => {
  const first = await open()
  first.store.add(anchor, 'Saved comment.')
  first.store.setEditor({ anchor, comment: 'Unfinished comment.' })
  expect(first.prepare().reserve('queue-send')).toBe(true)
  expect(first.store.getSnapshot()).toEqual({ notes: [] })
  expect(first.stored.read().notes).toHaveLength(1)
  vi.resetModules()
  const reopened = await open()
  expect(reopened.store).not.toBe(first.store)
  expect(reopened.store.getSnapshot()).toEqual({ notes: [] })
  reopened.reconcile([], [{ messageId: 'queue-send', state: 'waiting' }])
  expect(reopened.prepare('New follow-up.').text).toBe('New follow-up.')
  reopened.reconcile([], [{ messageId: 'queue-send', state: 'returned' }])
  expect(reopened.store.getSnapshot().notes[0]).toMatchObject({
    ...anchor,
    comment: 'Saved comment.'
  })
  expect(reopened.store.getSnapshot().editor).toMatchObject({
    anchor,
    comment: 'Unfinished comment.'
  })
})

it('consumes captured revisions only after the queued handoff is accepted', async () => {
  const context = await open()
  context.store.add(anchor, 'Saved comment.')
  context.store.setEditor({ anchor, comment: 'Unfinished comment.' })
  context.prepare().reserve('queue-send')
  for (const state of ['pending', 'unknown'] as const) {
    context.reconcile([submission(state)])
    expect(context.stored.read().notes).toHaveLength(1)
    expect(context.stored.read().editor).toBeDefined()
  }
  context.reconcile([submission('accepted')])
  expect(context.stored.read()).toEqual({ notes: [] })
  vi.resetModules()
  expect((await open()).store.getSnapshot()).toEqual({ notes: [] })
})

it('preserves newer note and editor revisions written in another window before acceptance', async () => {
  const first = await open()
  const note = first.store.add(anchor, 'Before.')
  if (!note) {
    throw new Error('Missing note')
  }
  first.store.setEditor({ anchor, comment: 'Before editor.' })
  const captured = first.prepare()
  vi.resetModules()
  const other = await open()
  other.store.update(note.id, 'Newer note.')
  other.store.setEditor({ anchor, comment: 'Newer editor.' })
  captured.reserve('queue-send')
  first.reconcile([submission('accepted')])
  vi.resetModules()
  const reopened = await open()
  expect(reopened.store.getSnapshot().notes[0]?.comment).toBe('Newer note.')
  expect(reopened.store.getSnapshot().editor?.comment).toBe('Newer editor.')
})

it('restores annotations for a direct admission later rejected and retained as a returned card', async () => {
  const context = await open()
  context.store.add(anchor, 'Keep the editable anchor.')
  context.prepare().reserve('direct-send')
  context.reconcile(
    [
      submission('rejected', {
        clientMessageId: 'direct-send',
        queuedMessageId: undefined,
        keptAsQueuedMessageId: 'returned-card'
      })
    ],
    [{ messageId: 'returned-card', state: 'returned' }]
  )
  expect(context.store.getSnapshot().notes[0]?.comment).toBe('Keep the editable anchor.')
})

it('keeps notes visible with a persistence error if the delivery receipt cannot be saved', async () => {
  const context = await open()
  context.store.add(anchor, 'Durable comment.')
  const write = localStorage.setItem.bind(localStorage)
  const blocked = vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
    if (key.includes(':delivery:')) {
      throw new Error('Receipt storage full')
    }
    write(key, value)
  })
  expect(context.prepare().reserve('queue-send')).toBe(false)
  expect(context.store.getSnapshot().notes).toHaveLength(1)
  expect(context.store.getSnapshot().persistenceError).toBe('Receipt storage full')
  blocked.mockRestore()
})

it('does not lose the anchor if accepted-send cleanup is retried after renderer reload', async () => {
  const context = await open()
  context.store.add(anchor, 'Durable comment.')
  context.prepare().reserve('queue-send')
  const write = localStorage.setItem.bind(localStorage)
  const blocked = vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
    if (key.includes(':consumed-note:')) {
      throw new Error('Cleanup blocked')
    }
    write(key, value)
  })
  context.reconcile([submission('accepted')])
  expect(context.stored.read().notes).toHaveLength(1)
  expect(context.store.getSnapshot().persistenceError).toBe('Cleanup blocked')
  blocked.mockRestore()
  vi.resetModules()
  const reopened = await open()
  reopened.reconcile([submission('accepted')])
  expect(reopened.stored.read()).toEqual({ notes: [] })
})

it('tracks a returned card through retry and cleans it after the latest handoff succeeds', async () => {
  const context = await open()
  context.store.add(anchor, 'Retry this comment.')
  context.prepare().reserve('queue-send')
  const rejected = submission('rejected', { submittedAt: 1, resolvedAt: 2 })
  context.reconcile([rejected], [{ messageId: 'queue-send', state: 'returned' }])
  expect(context.store.getSnapshot().notes).toHaveLength(1)
  context.reconcile([rejected], [{ messageId: 'queue-send', state: 'waiting' }])
  expect(context.store.getSnapshot().notes).toHaveLength(0)
  const retry = submission('pending', {
    clientMessageId: 'retry-send',
    submittedAt: 3,
    resolvedAt: null
  })
  context.reconcile([rejected, retry])
  expect(context.stored.read().notes).toHaveLength(1)
  context.reconcile([rejected, { ...retry, dispatchState: 'accepted', resolvedAt: 4 }])
  expect(context.stored.read()).toEqual({ notes: [] })
})

it('replaces the restored serialized annotation rather than adding it twice on composer retry', async () => {
  const context = await open()
  const note = context.store.add(anchor, 'Original comment.')
  if (!note) {
    throw new Error('Missing note')
  }
  const sent = context.prepare('Original draft.')
  sent.reserve('direct-send')
  sent.release('direct-send')
  context.store.update(note.id, 'Edited after failure.')
  expect(context.prepare(sent.text).text).toBe(
    'Original draft.\n\n> Selected passage.\n\nEdited after failure.'
  )
})

it('bounds failed cleanup attempts while mounted and retries after the user restores storage', async () => {
  const context = await open()
  context.store.add(anchor, 'Durable comment.')
  context.prepare().reserve('queue-send')
  const write = localStorage.setItem.bind(localStorage)
  let attempts = 0
  const blocked = vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
    if (key.includes(':consumed-note:')) {
      attempts++
      throw new Error('Cleanup blocked')
    }
    write(key, value)
  })
  const state = { submissions: [submission('accepted')], cards: [] }
  const hook = renderHook(() => context.useDelivery(scope, state))
  expect(attempts).toBeGreaterThan(0)
  expect(attempts).toBeLessThanOrEqual(2)
  expect(context.store.getSnapshot().persistenceError).toBe('Cleanup blocked')
  blocked.mockRestore()
  act(() => {
    context.store.retryPersistence()
  })
  expect(context.stored.read()).toEqual({ notes: [] })
  expect(context.store.getSnapshot().persistenceError).toBeUndefined()
  hook.unmount()
})
