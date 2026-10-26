import { createServer, type IncomingMessage, type Server } from 'node:http'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { AGENT_SUDO_ASKPASS_PATHNAME } from './agent-sudo-scripts'

export type AgentSudoAskpassRequest = {
  sudoPid: number | null
  command: string
  cwd: string
  prompt: string
}

export type AgentSudoAskpassHandler = (
  request: AgentSudoAskpassRequest,
  signal: AbortSignal
) => Promise<string | null>

export type AgentSudoAskpassServer = {
  /** `port token`, the line the endpoint file publishes to the askpass helper. */
  endpointLine: string
  close: () => Promise<void>
}

const MAX_DECODED_HEADER_BYTES = 4096

function readEncodedHeader(req: IncomingMessage, name: string): string {
  const raw = req.headers[name]
  if (typeof raw !== 'string' || raw.length > MAX_DECODED_HEADER_BYTES * 2) {
    return ''
  }
  return Buffer.from(raw, 'base64').toString('utf8').trim()
}

function readSudoPid(req: IncomingMessage): number | null {
  const raw = req.headers['x-orca-sudo-pid']
  if (typeof raw !== 'string' || !/^[1-9]\d{0,9}$/.test(raw)) {
    return null
  }
  return Number(raw)
}

function tokenMatches(expected: Buffer, received: unknown): boolean {
  if (typeof received !== 'string') {
    return false
  }
  const actual = Buffer.from(received, 'utf8')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

/** Loopback-only; callers publish `endpointLine` in a 0600 file, never in a child's environment. */
export async function startAgentSudoAskpassServer(options: {
  onRequest: AgentSudoAskpassHandler
}): Promise<AgentSudoAskpassServer> {
  const token = randomUUID()
  const expectedToken = Buffer.from(token, 'utf8')
  const server: Server = createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
    if (req.method !== 'POST' || pathname !== AGENT_SUDO_ASKPASS_PATHNAME) {
      res.writeHead(404).end()
      return
    }
    if (!tokenMatches(expectedToken, req.headers['x-orca-sudo-token'])) {
      res.writeHead(403).end()
      return
    }
    // The helper posts an empty body; drain anything else without buffering it.
    req.resume()
    const abort = new AbortController()
    res.on('close', () => {
      if (!res.writableFinished) {
        abort.abort()
      }
    })
    const request: AgentSudoAskpassRequest = {
      sudoPid: readSudoPid(req),
      command: readEncodedHeader(req, 'x-orca-sudo-command'),
      cwd: readEncodedHeader(req, 'x-orca-sudo-cwd'),
      prompt: readEncodedHeader(req, 'x-orca-sudo-prompt')
    }
    options
      .onRequest(request, abort.signal)
      .then((password) => {
        if (password === null) {
          res.writeHead(403).end()
          return
        }
        res.writeHead(200, {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store'
        })
        res.end(`${password}\n`)
      })
      .catch((error: unknown) => {
        console.warn('[agent-sudo] askpass request failed', error)
        res.writeHead(500).end()
      })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address !== 'object') {
    server.close()
    throw new Error('sudo askpass server has no address')
  }
  return {
    endpointLine: `${address.port} ${token}\n`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
  }
}
