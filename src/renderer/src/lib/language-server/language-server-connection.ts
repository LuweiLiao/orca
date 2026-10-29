/** JSON-RPC 2.0 over one language server session: requests, notifications, and server calls. */
export type LanguageServerConnection = {
  request: <T>(method: string, params: unknown, signal?: AbortSignal) => Promise<T>
  notify: (method: string, params: unknown) => void
  /** Answers requests the server sends (workspace/configuration, ...). */
  onRequest: (method: string, handler: (params: unknown) => unknown) => void
  onNotification: (method: string, handler: (params: unknown) => void) => void
  /** Feeds one message the server sent. */
  receive: (message: unknown) => void
  /** Fails every pending request; later calls fail at once. */
  close: (reason: string) => void
}

export class LanguageServerError extends Error {
  constructor(
    message: string,
    readonly code: number | null
  ) {
    super(message)
  }
}

// LSP: the client cancelled the request.
const REQUEST_CANCELLED = -32800
const METHOD_NOT_FOUND = -32601

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void }

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined
}

export function createLanguageServerConnection(
  send: (message: unknown) => void
): LanguageServerConnection {
  let nextId = 1
  let closed: string | null = null
  const pending = new Map<number, Pending>()
  const requestHandlers = new Map<string, (params: unknown) => unknown>()
  const notificationHandlers = new Map<string, (params: unknown) => void>()

  const respond = async (id: unknown, method: string, params: unknown): Promise<void> => {
    const handler = requestHandlers.get(method)
    if (!handler) {
      send({ jsonrpc: '2.0', id, error: { code: METHOD_NOT_FOUND, message: method } })
      return
    }
    try {
      send({ jsonrpc: '2.0', id, result: (await handler(params)) ?? null })
    } catch (error) {
      send({ jsonrpc: '2.0', id, error: { code: -32603, message: String(error) } })
    }
  }

  return {
    request<T>(method: string, params: unknown, signal?: AbortSignal): Promise<T> {
      if (closed !== null) {
        return Promise.reject(new LanguageServerError(closed, null))
      }
      const id = nextId++
      return new Promise<T>((resolve, reject) => {
        const onAbort = (): void => {
          if (pending.delete(id)) {
            send({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id } })
            reject(new LanguageServerError('Request cancelled', REQUEST_CANCELLED))
          }
        }
        pending.set(id, {
          resolve: (value) => {
            signal?.removeEventListener('abort', onAbort)
            // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the caller names the result type of the LSP method it called.
            resolve(value as T)
          },
          reject: (error) => {
            signal?.removeEventListener('abort', onAbort)
            reject(error)
          }
        })
        if (signal?.aborted) {
          onAbort()
          return
        }
        signal?.addEventListener('abort', onAbort, { once: true })
        send({ jsonrpc: '2.0', id, method, params })
      })
    },
    notify(method, params) {
      if (closed === null) {
        send({ jsonrpc: '2.0', method, params })
      }
    },
    onRequest(method, handler) {
      requestHandlers.set(method, handler)
    },
    onNotification(method, handler) {
      notificationHandlers.set(method, handler)
    },
    receive(message) {
      const id = field(message, 'id')
      const method = field(message, 'method')
      if (typeof method === 'string') {
        if (id !== undefined && id !== null) {
          void respond(id, method, field(message, 'params'))
        } else {
          notificationHandlers.get(method)?.(field(message, 'params'))
        }
        return
      }
      if (typeof id !== 'number') {
        return
      }
      const waiter = pending.get(id)
      if (!waiter) {
        return
      }
      pending.delete(id)
      const error = field(message, 'error')
      if (error !== undefined) {
        const code = field(error, 'code')
        waiter.reject(
          new LanguageServerError(
            String(field(error, 'message') ?? 'Language server error'),
            typeof code === 'number' ? code : null
          )
        )
      } else {
        waiter.resolve(field(message, 'result') ?? null)
      }
    },
    close(reason) {
      closed = reason
      for (const waiter of pending.values()) {
        waiter.reject(new LanguageServerError(reason, null))
      }
      pending.clear()
    }
  }
}
