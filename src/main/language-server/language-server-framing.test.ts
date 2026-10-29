import { describe, expect, it } from 'vitest'
import {
  createLanguageServerMessageReader,
  encodeLanguageServerMessage
} from './language-server-framing'

describe('language server framing', () => {
  it('reassembles messages split across chunks, counting UTF-8 bytes', () => {
    const first = { jsonrpc: '2.0', id: 1, result: { text: '注释 ✓' } }
    const second = { jsonrpc: '2.0', method: 'window/logMessage', params: {} }
    const bytes = Buffer.concat([
      encodeLanguageServerMessage(first),
      encodeLanguageServerMessage(second)
    ])
    const reader = createLanguageServerMessageReader()
    const received: unknown[] = []
    // Byte-by-byte splits a header, a multi-byte character, and the gap between messages.
    for (let index = 0; index < bytes.length; index += 1) {
      received.push(...reader.push(bytes.subarray(index, index + 1)))
    }
    expect(received).toEqual([first, second])
  })

  it('rejects a stream it cannot frame', () => {
    const reader = createLanguageServerMessageReader()
    expect(() => reader.push(Buffer.from('Content-Type: x\r\n\r\n{}'))).toThrow(/Content-Length/)
  })
})
