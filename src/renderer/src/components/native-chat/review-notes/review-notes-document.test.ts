import { describe, expect, it } from 'vitest'
import { promptTextContent } from '../composer/editor/native-chat-prompt-document-text'
import { promptDocumentText, withReviewNoteInDocument } from './review-notes-document'

const PDF_NOTE = [
  'File: paper/main.pdf',
  'Source: pdf',
  'Page: 2',
  'Excerpt:',
  '> 统一模',
  'User comment: "统一模型感觉写的过了"'
].join('\n')
const TEX_NOTE = [
  'File: paper/method.tex',
  'Source: text',
  'Line: 12',
  'User comment: "Cite this"'
].join('\n')

describe('review notes in a chat draft', () => {
  it('folds every note into one pill that sends them all in full', () => {
    const typed = promptTextContent('Please fix these')
    const once = withReviewNoteInDocument(typed, 'Please fix these', PDF_NOTE)
    const twice = withReviewNoteInDocument(once, promptDocumentText(once), TEX_NOTE)

    expect(twice.content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'Please fix these' }] },
      {
        type: 'paragraph',
        content: [
          {
            type: 'nativeChatReviewNotes',
            attrs: { count: 2, body: `${PDF_NOTE}\n\n${TEX_NOTE}` }
          }
        ]
      }
    ])
    const sent = promptDocumentText(twice)
    expect(sent).toBe(
      `Please fix these\n<orca-review-notes count="2">\n${PDF_NOTE}\n\n${TEX_NOTE}\n</orca-review-notes>`
    )
    // A draft restored from its text comes back as the same pill.
    expect(promptTextContent(sent)).toEqual(twice)
  })

  it('puts the pill in place of an empty draft', () => {
    const empty = promptTextContent('')
    expect(withReviewNoteInDocument(empty, '', TEX_NOTE).content).toEqual([
      {
        type: 'paragraph',
        content: [{ type: 'nativeChatReviewNotes', attrs: { count: 1, body: TEX_NOTE } }]
      }
    ])
  })
})
