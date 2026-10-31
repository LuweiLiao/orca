import { describe, expect, it } from 'vitest'
import { deriveNativeChatRowContent } from './native-chat-row-content'
import type { NativeChatBlock } from './native-chat-types'

describe('image reads in chat rows', () => {
  it.each(['D:\\project\\shot\\iomcu-1s.png', '/home/me/project/shot/image.PNG'])(
    'shows the successful image read %s even when the stored output is empty',
    (path) => {
      const content = deriveNativeChatRowContent([
        {
          type: 'tool-call',
          name: 'Read',
          input: { file_path: path },
          callId: 'read',
          state: 'completed'
        },
        { type: 'tool-result', callId: 'read', output: '' }
      ])
      expect(content.prose).toContainEqual({ type: 'image-ref', path })
      expect(content.hasImages).toBe(true)
      expect(content.tools).toHaveLength(2)
    }
  )

  it('pairs transcript results by call ID and keeps only successful image reads', () => {
    const blocks: NativeChatBlock[] = [
      {
        type: 'tool-call',
        name: 'Read',
        input: { file_path: '/repo/failed.png' },
        callId: 'failed'
      },
      { type: 'tool-call', name: 'Read', input: { file_path: '/repo/good.png' }, callId: 'good' },
      { type: 'tool-result', callId: 'good', output: '' },
      { type: 'tool-result', callId: 'failed', output: 'File not found', isError: true }
    ]
    expect(deriveNativeChatRowContent(blocks).prose).toEqual([
      { type: 'image-ref', path: '/repo/good.png' }
    ])
  })

  it('does not duplicate existing images or preview unfinished reads and ordinary files', () => {
    const image: NativeChatBlock = { type: 'image-ref', path: '/repo/image.png' }
    const content = deriveNativeChatRowContent([
      image,
      {
        type: 'tool-call',
        name: 'Read',
        input: { file_path: '/repo/image.png' },
        state: 'completed'
      },
      {
        type: 'tool-call',
        name: 'Read',
        input: { file_path: '/repo/running.png' },
        state: 'running'
      },
      { type: 'tool-call', name: 'Read', input: { file_path: '/repo/unknown.png' } },
      {
        type: 'tool-call',
        name: 'Read',
        input: { file_path: '/repo/file.ts' },
        state: 'completed'
      },
      {
        type: 'tool-call',
        name: 'Write',
        input: { file_path: '/repo/written.png' },
        state: 'completed'
      }
    ])
    expect(content.prose).toEqual([image])
  })
})
