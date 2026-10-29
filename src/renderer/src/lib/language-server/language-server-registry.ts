import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type { LanguageServerId } from '../../../../shared/language-server-types'
import { startLanguageServerClient, type LanguageServerClient } from './language-server-client'
import type { LanguageServerConnection } from './language-server-connection'

/** One server process for one workspace root, shared by every open document under it. */
export type LanguageServerEntry = {
  serverId: LanguageServerId
  rootPath: string
  rootUri: string
  client: LanguageServerClient | null
  ready: Promise<LanguageServerClient | null>
  documents: number
}

type Lifecycle = {
  ready: (entry: LanguageServerEntry, client: LanguageServerClient) => void
  lost: (entry: LanguageServerEntry) => void
  notifications: (entry: LanguageServerEntry, connection: LanguageServerConnection) => void
}

// Why: a server holds its index in memory; stop it a while after its last document closes.
const IDLE_STOP_MS = 5 * 60_000
// Why: a server that keeps crashing on start is broken; stop retrying and say so once.
const MAX_RESTARTS = 3
// Why: re-check a missing server later, so installing it does not need an Orca restart.
const MISSING_RETRY_MS = 60_000

const entries = new Map<string, LanguageServerEntry>()
const idleTimers = new Map<LanguageServerEntry, ReturnType<typeof setTimeout>>()
const restarts = new Map<LanguageServerEntry, number>()
const sessionOf = new Map<LanguageServerEntry, string>()
const receivers = new Map<string, (message: unknown) => void>()
const missingUntil = new Map<LanguageServerId, number>()
let lifecycle: Lifecycle | null = null
let bridgeInstalled = false

export function setLanguageServerLifecycle(next: Lifecycle): void {
  lifecycle = next
}

function installBridge(): void {
  const api = window.api?.languageServer
  if (bridgeInstalled || !api) {
    return
  }
  bridgeInstalled = true
  api.onMessage(({ sessionId, message }) => receivers.get(sessionId)?.(message))
  api.onExit(({ sessionId, stderrTail }) => {
    const entry = [...sessionOf].find(([, id]) => id === sessionId)?.[0]
    if (entry) {
      handleExit(entry, stderrTail)
    }
  })
}

function handleExit(entry: LanguageServerEntry, stderrTail: string): void {
  sessionOf.delete(entry)
  entry.client = null
  lifecycle?.lost(entry)
  if (entries.get(keyOf(entry.serverId, entry.rootPath)) !== entry || entry.documents === 0) {
    return
  }
  const count = (restarts.get(entry) ?? 0) + 1
  restarts.set(entry, count)
  if (count > MAX_RESTARTS) {
    toast.error(
      translate('auto.lib.languageServer.crashed', '{{server}} keeps stopping.', {
        server: entry.serverId
      }),
      { description: stderrTail.trim().split('\n').slice(-3).join('\n') || undefined }
    )
    return
  }
  entry.ready = start(entry)
}

function keyOf(serverId: LanguageServerId, rootPath: string): string {
  return `${serverId}\0${rootPath}`
}

async function start(entry: LanguageServerEntry): Promise<LanguageServerClient | null> {
  installBridge()
  const result = await startLanguageServerClient({
    serverId: entry.serverId,
    rootPath: entry.rootPath,
    rootUri: entry.rootUri,
    subscribe: (sessionId, receive) => {
      sessionOf.set(entry, sessionId)
      receivers.set(sessionId, receive)
      return () => receivers.delete(sessionId)
    },
    onNotification: (connection) => lifecycle?.notifications(entry, connection)
  })
  if (!result.ok) {
    sessionOf.delete(entry)
    if (result.reason === 'missing') {
      noteMissing(entry.serverId, result.message)
    }
    // Why drop it: the next document asks again, after the missing-server backoff.
    if (entries.get(keyOf(entry.serverId, entry.rootPath)) === entry) {
      entries.delete(keyOf(entry.serverId, entry.rootPath))
    }
    return null
  }
  if (entries.get(keyOf(entry.serverId, entry.rootPath)) !== entry) {
    result.client.stop()
    return null
  }
  entry.client = result.client
  lifecycle?.ready(entry, result.client)
  return result.client
}

function noteMissing(serverId: LanguageServerId, message: string): void {
  const firstTime = !missingUntil.has(serverId)
  missingUntil.set(serverId, Date.now() + MISSING_RETRY_MS)
  if (firstTime) {
    toast.info(
      translate(
        'auto.lib.languageServer.missing',
        '{{server}} is not installed, so code navigation is off for these files.',
        { server: serverId }
      ),
      { description: message }
    )
  }
}

/** The server for `rootPath`, started on first use; null while it is known to be missing. */
export function acquireLanguageServer(
  serverId: LanguageServerId,
  rootPath: string,
  rootUri: string
): LanguageServerEntry | null {
  if ((missingUntil.get(serverId) ?? 0) > Date.now()) {
    return null
  }
  const key = keyOf(serverId, rootPath)
  let entry = entries.get(key)
  if (!entry) {
    const created: LanguageServerEntry = {
      serverId,
      rootPath,
      rootUri,
      client: null,
      ready: Promise.resolve(null),
      documents: 0
    }
    entries.set(key, created)
    created.ready = start(created)
    entry = created
  }
  const timer = idleTimers.get(entry)
  if (timer) {
    clearTimeout(timer)
    idleTimers.delete(entry)
  }
  entry.documents += 1
  return entry
}

export function releaseLanguageServer(entry: LanguageServerEntry): void {
  entry.documents = Math.max(0, entry.documents - 1)
  if (entry.documents > 0 || idleTimers.has(entry)) {
    return
  }
  idleTimers.set(
    entry,
    setTimeout(() => {
      idleTimers.delete(entry)
      if (entry.documents > 0) {
        return
      }
      entries.delete(keyOf(entry.serverId, entry.rootPath))
      sessionOf.delete(entry)
      restarts.delete(entry)
      entry.client?.stop()
      entry.client = null
    }, IDLE_STOP_MS)
  )
}
