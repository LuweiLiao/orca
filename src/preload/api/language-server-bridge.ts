import { ipcRenderer } from 'electron'
import type {
  LanguageServerExitEvent,
  LanguageServerMessageEvent,
  LanguageServerStartArgs,
  LanguageServerStartResult
} from '../../shared/language-server-types'

export type LanguageServerApi = {
  start: (args: LanguageServerStartArgs) => Promise<LanguageServerStartResult>
  send: (sessionId: string, message: unknown) => void
  stop: (sessionId: string) => void
  onMessage: (callback: (event: LanguageServerMessageEvent) => void) => () => void
  onExit: (callback: (event: LanguageServerExitEvent) => void) => () => void
}

export const languageServerApi: LanguageServerApi = {
  start: (args) => ipcRenderer.invoke('languageServer:start', args),
  send: (sessionId, message) => ipcRenderer.send('languageServer:send', sessionId, message),
  stop: (sessionId) => ipcRenderer.send('languageServer:stop', sessionId),
  onMessage: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: LanguageServerMessageEvent
    ): void => callback(payload)
    ipcRenderer.on('languageServer:message', listener)
    return () => ipcRenderer.removeListener('languageServer:message', listener)
  },
  onExit: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: LanguageServerExitEvent): void =>
      callback(payload)
    ipcRenderer.on('languageServer:exit', listener)
    return () => ipcRenderer.removeListener('languageServer:exit', listener)
  }
}
