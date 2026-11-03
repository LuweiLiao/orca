import { expect, it } from 'vitest'
import type { NativeChatBlock, NativeChatMessage } from '../../../../shared/native-chat-types'
import { nativeChatGalleryImages } from './native-chat-gallery-images'

const message = (id: string, blocks: NativeChatBlock[]): NativeChatMessage => ({
  id,
  role: 'assistant',
  blocks,
  timestamp: null,
  source: 'transcript'
})

it('orders attachments, successful tool results and Markdown images across transcript rows', () => {
  const images = nativeChatGalleryImages([
    message('attachment', [{ type: 'image-ref', path: 'D:\\plots\\first.png' }]),
    message('tool', [
      {
        type: 'tool-call',
        name: 'Bash',
        callId: 'plot',
        state: 'completed',
        input: { command: 'python plot.py' }
      },
      { type: 'tool-result', callId: 'plot', output: '/repo/tool.png' }
    ]),
    message('reply', [
      {
        type: 'text',
        text: '![Third](/repo/third.png)\n\n`/repo/fourth.png`\n\n![Fifth][plot]\n\n[plot]: /repo/fifth.png'
      }
    ])
  ])
  expect(images.map((image) => [image.messageId, image.source])).toEqual([
    ['attachment', 'D:\\plots\\first.png'],
    ['tool', '/repo/tool.png'],
    ['reply', '/repo/third.png'],
    ['reply', '/repo/fourth.png'],
    ['reply', '/repo/fifth.png']
  ])
})

it('keeps repeated images in different messages while omitting fenced examples and failed tools', () => {
  const images = nativeChatGalleryImages([
    message('one', [
      { type: 'image-ref', path: '/repo/repeated.png' },
      {
        type: 'text',
        text: '![Again](/repo/repeated.png)\n\n```md\n![Example](/repo/example.png)\n```'
      }
    ]),
    message('two', [{ type: 'image-ref', path: '/repo/repeated.png' }]),
    message('failed', [
      { type: 'tool-call', name: 'Bash', callId: 'failed', state: 'failed', input: {} },
      { type: 'tool-result', callId: 'failed', isError: true, output: '/repo/failed.png' }
    ])
  ])
  expect(images.map((image) => image.messageId)).toEqual(['one', 'two'])
})
