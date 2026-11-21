import { ipcMain } from 'electron'
import { isTrustedUIRenderer } from './ui'
import { openNativeDesktopWindow } from '../window/native-windows/native-desktop-windows'
import type { RuntimeClientWindowOpenResult } from '../../shared/app-lifecycle/windows/runtime-client-window-open-result'

export function registerRuntimeClientWindowHandlers(): void {
  ipcMain.removeHandler('window:openRuntimeClientWindow')
  ipcMain.handle(
    'window:openRuntimeClientWindow',
    async (event, args: unknown): Promise<RuntimeClientWindowOpenResult> => {
      if (!isTrustedUIRenderer(event.sender)) {
        return { ok: false, reason: 'untrusted_sender' }
      }
      const worktreeId =
        args && typeof args === 'object' && 'worktreeId' in args ? args.worktreeId : undefined
      const result = await openNativeDesktopWindow(
        typeof worktreeId === 'string' && worktreeId ? { worktreeId } : undefined
      )
      // Why not the window: a BrowserWindow cannot cross IPC, and the renderer only needs the outcome.
      return result.ok ? { ok: true } : { ok: false, reason: result.reason }
    }
  )
}
