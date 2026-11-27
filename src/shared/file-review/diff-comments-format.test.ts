import { describe, expect, it } from 'vitest'
import { formatDiffComments } from './diff-comments-format'

describe('formatDiffComments', () => {
  it('sends the text a markdown range note was left on', () => {
    expect(
      formatDiffComments([
        {
          id: 'n1',
          worktreeId: 'w1',
          filePath: 'docs/design.md',
          source: 'markdown',
          selectedText: 'App publishing changes\nwhile it is in flight',
          startLine: 105,
          lineNumber: 115,
          body: 'Explain this',
          createdAt: 1,
          side: 'modified'
        }
      ])
    ).toBe(
      [
        'File: docs/design.md',
        'Source: markdown',
        'Lines: 105-115',
        'Excerpt:',
        '> App publishing changes',
        '> while it is in flight',
        'User comment: "Explain this"'
      ].join('\n')
    )
  })

  it('labels a line note on a non-markdown file as text', () => {
    expect(
      formatDiffComments([
        {
          id: 'n3',
          worktreeId: 'w1',
          filePath: 'paper/method.tex',
          source: 'markdown',
          selectedText: 'We fix the bar',
          lineNumber: 12,
          body: 'Cite this',
          createdAt: 1,
          side: 'modified'
        }
      ])
    ).toBe(
      [
        'File: paper/method.tex',
        'Source: text',
        'Line: 12',
        'Excerpt:',
        '> We fix the bar',
        'User comment: "Cite this"'
      ].join('\n')
    )
  })

  it('sends where a PDF note sits and the TeX lines behind it', () => {
    expect(
      formatDiffComments([
        {
          id: 'n2',
          worktreeId: 'w1',
          filePath: 'paper/main.pdf',
          source: 'pdf',
          pdfRegion: { page: 3, left: 72.4, top: 100, width: 300.2, height: 40.6 },
          pdfTexSource: { filePath: 'paper/method.tex', startLine: 12, endLine: 14 },
          selectedText: 'The gripper holds\nthe bar',
          lineNumber: 3,
          body: 'Say "why" here',
          createdAt: 1,
          side: 'modified'
        }
      ])
    ).toBe(
      [
        'File: paper/main.pdf',
        'Source: pdf',
        'Page: 3',
        "Region (PDF points from the page's top-left): x 72-373, y 100-141",
        'TeX source (SyncTeX): paper/method.tex:12-14',
        'Excerpt:',
        '> The gripper holds',
        '> the bar',
        'User comment: "Say \\"why\\" here"'
      ].join('\n')
    )
  })
})
