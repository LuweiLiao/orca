import { app, ipcMain } from 'electron'
import type { Store } from '../persistence'
import {
  isLanguageServerId,
  type LanguageServerStartArgs,
  type LanguageServerStartResult
} from '../../shared/language-server-types'
import { resolveDesktopAuthorizedPath } from '../ipc/local-file-access-resolution'
import {
  startLanguageServer,
  stopAllLanguageServers,
  stopLanguageServer,
  writeLanguageServerMessage
} from './language-server-sessions'

export function registerLanguageServerHandlers(store: Store): void {
  ipcMain.handle(
    'languageServer:start',
    async (event, args: LanguageServerStartArgs): Promise<LanguageServerStartResult> => {
      if (!isLanguageServerId(args?.serverId) || typeof args.rootPath !== 'string') {
        return { ok: false, reason: 'failed', message: 'Invalid language server request' }
      }
      let rootPath: string
      try {
        // Why: a server indexes and may build its root; only a registered workspace qualifies.
        rootPath = await resolveDesktopAuthorizedPath(args.rootPath, store)
      } catch (error) {
        return { ok: false, reason: 'unauthorized', message: String(error) }
      }
      return startLanguageServer(event.sender, args.serverId, rootPath)
    }
  )
  ipcMain.on('languageServer:send', (event, sessionId: unknown, message: unknown) => {
    if (typeof sessionId === 'string') {
      writeLanguageServerMessage(event.sender, sessionId, message)
    }
  })
  ipcMain.on('languageServer:stop', (event, sessionId: unknown) => {
    if (typeof sessionId === 'string') {
      stopLanguageServer(sessionId, event.sender)
    }
  })
  app.on('will-quit', stopAllLanguageServers)
}
