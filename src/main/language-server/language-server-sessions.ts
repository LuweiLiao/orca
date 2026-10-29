import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import { spawnProcess } from '@orca/process-host'
import type { PipedChildProcess } from '@orca/process-host/process-spec'
import {
  forceTerminateProcessTree,
  signalProcessTree
} from '@orca/process-host/process-tree-termination'
import type {
  LanguageServerExitEvent,
  LanguageServerId,
  LanguageServerMessageEvent,
  LanguageServerStartResult
} from '../../shared/language-server-types'
import { resolveCommandOnLocalPath } from '../ipc/command-path-resolver'
import { abortWhenRendererGone } from '../ipc/renderer-lifetime-abort'
import { hydrateShellPath, mergePathSegments } from '../startup/hydrate-shell-path'
import { languageServerLaunch } from './language-server-catalog'
import {
  createLanguageServerMessageReader,
  encodeLanguageServerMessage
} from './language-server-framing'

export const LANGUAGE_SERVER_MESSAGE_CHANNEL = 'languageServer:message'
export const LANGUAGE_SERVER_EXIT_CHANNEL = 'languageServer:exit'
const STDERR_TAIL_BYTES = 4 * 1024
// Why: a server asked to exit gets this long to flush its index before it is killed.
const STOP_GRACE_MS = 2_000

type Session = {
  child: PipedChildProcess
  owner: WebContents
  stderrTail: string
  releaseOwner: () => void
}

const sessions = new Map<string, Session>()

/** Starts `serverId` for `rootPath`, owned by the window that asked; it stops when that goes. */
export async function startLanguageServer(
  owner: WebContents,
  serverId: LanguageServerId,
  rootPath: string
): Promise<LanguageServerStartResult> {
  // Why: a desktop launch has a bare PATH; servers from nvm or rustup live on the login PATH.
  const hydration = await hydrateShellPath()
  if (hydration.ok) {
    mergePathSegments(hydration.segments)
  }
  const launch = await languageServerLaunch(serverId, rootPath)
  const program = await resolveCommandOnLocalPath(launch.command)
  if (!program) {
    return { ok: false, reason: 'missing', message: `${launch.command} was not found on PATH` }
  }
  let child: PipedChildProcess
  try {
    child = spawnProcess({
      program,
      args: launch.args,
      cwd: rootPath,
      stdio: 'pipe',
      detached: process.platform !== 'win32'
    })
  } catch (error) {
    return { ok: false, reason: 'failed', message: String(error) }
  }
  const sessionId = randomUUID()
  const lifetime = abortWhenRendererGone(owner)
  const session: Session = {
    child,
    owner,
    stderrTail: '',
    releaseOwner: lifetime.dispose
  }
  sessions.set(sessionId, session)
  lifetime.signal.addEventListener('abort', () => stopLanguageServer(sessionId), { once: true })

  const reader = createLanguageServerMessageReader()
  child.stdout.on('data', (chunk: Buffer) => {
    let messages: unknown[]
    try {
      messages = reader.push(chunk)
    } catch (error) {
      session.stderrTail += `\n${String(error)}`
      stopLanguageServer(sessionId)
      return
    }
    for (const message of messages) {
      send(session, LANGUAGE_SERVER_MESSAGE_CHANNEL, { sessionId, message })
    }
  })
  child.stderr.on('data', (chunk: Buffer) => {
    session.stderrTail = (session.stderrTail + chunk.toString('utf8')).slice(-STDERR_TAIL_BYTES)
  })
  // Why: a server that dies mid-write must not crash the main process with EPIPE.
  child.stdin.on('error', () => undefined)
  child.on('error', (error) => {
    session.stderrTail += `\n${String(error)}`
  })
  child.on('exit', (code) => {
    if (sessions.get(sessionId) !== session) {
      return
    }
    sessions.delete(sessionId)
    session.releaseOwner()
    send(session, LANGUAGE_SERVER_EXIT_CHANNEL, {
      sessionId,
      code,
      stderrTail: session.stderrTail
    })
  })
  return { ok: true, sessionId }
}

function send(
  session: Session,
  channel: string,
  payload: LanguageServerMessageEvent | LanguageServerExitEvent
): void {
  if (!session.owner.isDestroyed()) {
    session.owner.send(channel, payload)
  }
}

/** Writes one JSON-RPC message to a session the sender owns. */
export function writeLanguageServerMessage(
  owner: WebContents,
  sessionId: string,
  message: unknown
): void {
  const session = sessions.get(sessionId)
  if (session?.owner === owner && session.child.stdin.writable) {
    session.child.stdin.write(encodeLanguageServerMessage(message))
  }
}

/** Ends a session: closes stdin, then kills the process tree if it has not exited in time. */
export function stopLanguageServer(sessionId: string, owner?: WebContents): void {
  const session = sessions.get(sessionId)
  if (!session || (owner && session.owner !== owner)) {
    return
  }
  sessions.delete(sessionId)
  session.releaseOwner()
  const { child } = session
  child.stdin.end()
  void signalProcessTree(child, 'SIGTERM').catch(() => false)
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      void forceTerminateProcessTree(child).catch(() => false)
    }
  }, STOP_GRACE_MS).unref()
}

export function stopAllLanguageServers(): void {
  for (const sessionId of sessions.keys()) {
    stopLanguageServer(sessionId)
  }
}
