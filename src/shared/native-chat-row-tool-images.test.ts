import { describe, expect, it } from 'vitest'
import { deriveNativeChatRowContent } from './native-chat-row-content'
import type { NativeChatBlock } from './native-chat-types'

describe('image reads in chat rows', () => {
  it('resolves returned relative images against the command working directory', () => {
    const content = deriveNativeChatRowContent([
      {
        type: 'tool-call',
        name: 'Bash',
        callId: 'list',
        state: 'completed',
        input: { command: 'cd "D:/project/review"; find ds -maxdepth 2' }
      },
      { type: 'tool-result', callId: 'list', output: 'ds/usb/core.png\nds/usb/pins.png' }
    ])
    expect(content.prose).toEqual([
      { type: 'image-ref', path: 'D:/project/review/ds/usb/core.png' },
      { type: 'image-ref', path: 'D:/project/review/ds/usb/pins.png' }
    ])
  })

  it.each(['/remote/project', 'D:/project', '//server/share/project'])(
    'uses an explicit tool directory %s for returned images',
    (cwd) => {
      const content = deriveNativeChatRowContent([
        {
          type: 'tool-call',
          name: 'exec_command',
          callId: 'plot',
          state: 'completed',
          input: { cmd: 'plot', workdir: cwd }
        },
        { type: 'tool-result', callId: 'plot', output: 'Saved plot: figs/result.png' }
      ])
      expect(content.prose).toEqual([{ type: 'image-ref', path: `${cwd}/figs/result.png` }])
    }
  )

  it.each([
    { command: 'cd figs; plot', workdir: '/repo' },
    { command: 'cd /repo/figs; plot' },
    { command: 'Set-Location -LiteralPath "/repo/figs"; plot' }
  ])('resolves a leading directory change in $command', (input) => {
    expect(
      deriveNativeChatRowContent([
        { type: 'tool-call', name: 'Bash', input, state: 'completed', callId: 'plot' },
        { type: 'tool-result', callId: 'plot', output: 'result.png' }
      ]).prose
    ).toEqual([{ type: 'image-ref', path: '/repo/figs/result.png' }])
  })

  it('does not guess the directory of relative command output', () => {
    expect(
      deriveNativeChatRowContent([
        {
          type: 'tool-call',
          name: 'Bash',
          input: { command: 'plot' },
          state: 'completed',
          callId: 'plot'
        },
        { type: 'tool-result', callId: 'plot', output: 'ds/usb/core.png' }
      ]).prose
    ).toEqual([])
  })

  it('does not turn source code, document image tags or quoted conversation input into images', () => {
    const output = [
      "('shot', 'app_screenshot', {'path': adc.HERE + r'\\shot\\usb3-1.png'})",
      '<img src="./Images/micro.png" />',
      JSON.stringify({ messages: [{ text: 'Read', input: { file_path: '/old/core.png' } }] })
    ].join('\n')
    expect(
      deriveNativeChatRowContent([
        {
          type: 'tool-call',
          name: 'Bash',
          input: { command: 'cat script.py' },
          state: 'completed',
          callId: 'read'
        },
        { type: 'tool-result', callId: 'read', output }
      ]).prose
    ).toEqual([])
  })

  it('does not duplicate an image explicitly published by the image CLI', () => {
    const content = deriveNativeChatRowContent([
      {
        type: 'tool-call',
        name: 'Bash',
        input: { command: 'orca image show result.png --json' },
        callId: 'show',
        state: 'completed'
      },
      {
        type: 'tool-result',
        callId: 'show',
        output: JSON.stringify({
          ok: true,
          result: {
            sessionId: 'claude_here',
            id: 'plot',
            itemId: 'orca:plot',
            path: '/repo/result.png',
            state: 'pending'
          }
        })
      }
    ])
    expect(content.prose).toEqual([])
  })
  it.each([
    '/home/ubuntu/project/figs/generated.png',
    'Saved plot: `/home/ubuntu/project/figs/plot with spaces.svg`',
    'Saved plot: figs/generated.png',
    '/repo/figs/result #1% done.png',
    "/repo/figs/author's-result.png",
    JSON.stringify({
      content: [{ type: 'text', text: JSON.stringify({ path: 'D:\\project\\figs\\result.png' }) }]
    })
  ])('shows an image reported by a successful command or MCP tool: %s', (output) => {
    const content = deriveNativeChatRowContent([
      {
        type: 'tool-call',
        name: 'Bash',
        callId: 'generate',
        input: { command: 'python plot.py', workdir: '/repo' },
        state: 'completed'
      },
      { type: 'tool-result', callId: 'generate', output }
    ])
    expect(content.hasImages).toBe(true)
    expect(content.prose.filter((block) => block.type === 'image-ref')).toHaveLength(1)
    expect(content.tools).toHaveLength(2)
  })

  it('shows successful SVG writes but not command input, errors or unfinished calls', () => {
    const content = deriveNativeChatRowContent([
      {
        type: 'tool-call',
        name: 'Write',
        input: { file_path: '/repo/diagram.svg', content: '<svg/>' },
        state: 'completed'
      },
      {
        type: 'tool-call',
        name: 'Bash',
        input: { command: 'python plot.py --output /repo/pending.png' },
        state: 'running',
        callId: 'pending'
      },
      { type: 'tool-result', callId: 'pending', output: '/repo/pending.png' },
      { type: 'tool-call', name: 'Bash', input: {}, state: 'failed', callId: 'failed' },
      { type: 'tool-result', callId: 'failed', output: '/repo/failed.png', isError: true },
      {
        type: 'tool-call',
        name: 'Bash',
        input: {},
        state: 'completed',
        exitCode: 1,
        callId: 'exit'
      },
      { type: 'tool-result', callId: 'exit', output: '/repo/exit.png' }
    ])
    expect(content.prose).toEqual([{ type: 'image-ref', path: '/repo/diagram.svg' }])
  })

  it('deduplicates returned image paths against an existing image block and repeated output', () => {
    const image: NativeChatBlock = { type: 'image-ref', path: '/repo/plot.png' }
    expect(
      deriveNativeChatRowContent([
        image,
        {
          type: 'tool-call',
          name: 'mcp__plot__render',
          input: {},
          state: 'completed',
          callId: 'plot'
        },
        {
          type: 'tool-result',
          callId: 'plot',
          output: JSON.stringify({ path: '/repo/plot.png', images: ['/repo/plot.png'] })
        }
      ]).prose
    ).toEqual([image])
  })

  it('shows multiple image output lines in order, including HTTP images, without including ordinary files', () => {
    const content = deriveNativeChatRowContent([
      {
        type: 'tool-call',
        name: 'mcp__plot__render',
        input: {},
        state: 'completed',
        callId: 'plot'
      },
      {
        type: 'tool-result',
        callId: 'plot',
        output:
          '/repo/first.png\n/repo/second.webp\nhttps://example.test/result.jpg\n/repo/data.csv'
      }
    ])
    expect(content.prose).toEqual([
      { type: 'image-ref', path: '/repo/first.png' },
      { type: 'image-ref', path: '/repo/second.webp' },
      { type: 'image-ref', url: 'https://example.test/result.jpg' }
    ])
  })

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
      }
    ])
    expect(content.prose).toEqual([image])
  })
})
