// LSP base protocol: `Content-Length: N\r\n\r\n` then N bytes of UTF-8 JSON.
const HEADER_END = Buffer.from('\r\n\r\n')
// Why a cap: a broken server that never sends a valid header must not grow the buffer forever.
const MAX_HEADER_BYTES = 8 * 1024
// Why: a workspace symbol or semantic-token reply can be several MB; 64 MB means a broken stream.
export const MAX_LANGUAGE_SERVER_MESSAGE_BYTES = 64 * 1024 * 1024
const CONTENT_LENGTH = /^content-length:\s*(\d+)\s*$/im

export function encodeLanguageServerMessage(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf8')
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body])
}

/**
 * Splits a byte stream into LSP messages. `push` returns the messages completed by the chunk;
 * it throws when the stream cannot be framed, after which the reader is unusable.
 */
export function createLanguageServerMessageReader(): { push: (chunk: Buffer) => unknown[] } {
  let buffer: Buffer = Buffer.alloc(0)
  let bodyLength: number | null = null
  return {
    push(chunk) {
      buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk])
      const messages: unknown[] = []
      for (;;) {
        if (bodyLength === null) {
          const headerEnd = buffer.indexOf(HEADER_END)
          if (headerEnd === -1) {
            if (buffer.length > MAX_HEADER_BYTES) {
              throw new Error('Language server sent a header without Content-Length')
            }
            return messages
          }
          const length = buffer.subarray(0, headerEnd).toString('ascii').match(CONTENT_LENGTH)?.[1]
          if (length === undefined) {
            throw new Error('Language server sent a header without Content-Length')
          }
          bodyLength = Number(length)
          if (bodyLength > MAX_LANGUAGE_SERVER_MESSAGE_BYTES) {
            throw new Error(`Language server message of ${bodyLength} bytes is too large`)
          }
          buffer = buffer.subarray(headerEnd + HEADER_END.length)
        }
        if (buffer.length < bodyLength) {
          return messages
        }
        const body = buffer.subarray(0, bodyLength).toString('utf8')
        buffer = buffer.subarray(bodyLength)
        bodyLength = null
        messages.push(JSON.parse(body))
      }
    }
  }
}
