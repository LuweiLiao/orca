import { expect, it } from 'vitest'
import { withNativeChatComposerDraftMetadata } from './native-chat-composer-draft-metadata'

const token = '12345678-1234-1234-1234-123456789abc'
const text = `[Pasted text](orca-paste:${token})`
const draft = { text, images: [], savedAt: 1, pastedTextFiles: { [token]: '/workspace/old.txt' } }
const document = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text, marks: [{ type: 'bold' }] }] }]
}

it('replaces file mappings owned by this draft while preserving foreign token mappings', () => {
  const foreignToken = '23456789-1234-1234-1234-123456789abc'
  const base = {
    ...draft,
    text: `${text}\n\n[Pasted text](orca-paste:${foreignToken})`,
    pastedTextFiles: { ...draft.pastedTextFiles, [foreignToken]: '/workspace/foreign.txt' }
  }
  const apply = withNativeChatComposerDraftMetadata((value) => value, draft, {
    pastedTextFiles: {}
  })
  expect(apply(base)?.pastedTextFiles).toEqual({ [foreignToken]: '/workspace/foreign.txt' })
})

it('preserves a matching document when retrying an appended draft and explicitly clears it when requested', () => {
  const set = withNativeChatComposerDraftMetadata((value) => value, draft, { document })
  expect(set(draft)?.document).toEqual(document)
  const cleared = withNativeChatComposerDraftMetadata(set, draft, { document: undefined })
  expect(cleared(draft)?.document).toBeUndefined()
})

it('does not attach an editor document to different text produced by a rebase', () => {
  const apply = withNativeChatComposerDraftMetadata((value) => value, draft, { document })
  expect(apply({ ...draft, text: 'Replaced in another window' })?.document).toBeUndefined()
})
