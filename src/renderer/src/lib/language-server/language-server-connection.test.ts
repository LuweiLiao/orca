import { describe, expect, it } from 'vitest'
import { createLanguageServerConnection, LanguageServerError } from './language-server-connection'

describe('language server connection', () => {
  it('matches replies to requests, answers server requests, and cancels', async () => {
    const sent: unknown[] = []
    const connection = createLanguageServerConnection((message) => sent.push(message))
    connection.onRequest('workspace/configuration', () => [null])

    const hover = connection.request('textDocument/hover', { a: 1 })
    connection.receive({ jsonrpc: '2.0', id: 1, result: { contents: 'x' } })
    await expect(hover).resolves.toEqual({ contents: 'x' })

    connection.receive({
      jsonrpc: '2.0',
      id: 'srv-1',
      method: 'workspace/configuration',
      params: {}
    })
    connection.receive({ jsonrpc: '2.0', id: 'srv-2', method: 'unknown/method' })
    await Promise.resolve()
    expect(sent).toContainEqual({ jsonrpc: '2.0', id: 'srv-1', result: [null] })
    expect(sent).toContainEqual({
      jsonrpc: '2.0',
      id: 'srv-2',
      error: { code: -32601, message: 'unknown/method' }
    })

    const controller = new AbortController()
    const slow = connection.request('textDocument/references', {}, controller.signal)
    controller.abort()
    await expect(slow).rejects.toBeInstanceOf(LanguageServerError)
    expect(sent).toContainEqual({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id: 2 } })

    const failing = connection.request('textDocument/definition', {})
    connection.receive({ jsonrpc: '2.0', id: 3, error: { code: -32603, message: 'boom' } })
    await expect(failing).rejects.toThrow('boom')

    const pending = connection.request('textDocument/completion', {})
    connection.close('stopped')
    await expect(pending).rejects.toThrow('stopped')
  })
})
