import { ipcMain, type IpcMainInvokeEvent } from 'electron'

const ACTIVE_CHANGED_CHANNEL = 'window:active-changed'
const IS_ACTIVE_CHANNEL = 'window:isActive'

type ActivityEvent = 'focus' | 'blur' | 'minimize' | 'restore' | 'hide' | 'show'

/** The parts of a BrowserWindow the relay uses. */
export type ActivityWindow = {
  isDestroyed: () => boolean
  isFocused: () => boolean
  isVisible: () => boolean
  isMinimized: () => boolean
  // Method syntax: BrowserWindow declares one overload per event, which only this form accepts.
  on(event: ActivityEvent, listener: () => void): unknown
  webContents: {
    id: number
    isDestroyed: () => boolean
    send: (channel: string, active: boolean) => void
  }
}

// Why keyed by sender: every native desktop window shares the one IPC channel.
const windowsByRendererId = new Map<number, ActivityWindow>()

function isSenderWindowActive(event: IpcMainInvokeEvent): boolean {
  const window = windowsByRendererId.get(event.sender.id)
  return window ? isWindowActive(window) : false
}

/** Focused, shown and not minimized: the window the user is looking at and working in. */
function isWindowActive(window: ActivityWindow): boolean {
  return !window.isDestroyed() && window.isFocused() && window.isVisible() && !window.isMinimized()
}

/** Tells the renderer when the window becomes or stops being active. Why from main: the
 *  renderer's `visibilityState` can stay 'visible' while the window is minimized or hidden. */
export function installMainWindowActivityRelay(window: ActivityWindow): { dispose: () => void } {
  let last: boolean | null = null
  const relay = (): void => {
    const active = isWindowActive(window)
    if (active === last || window.webContents.isDestroyed()) {
      return
    }
    last = active
    window.webContents.send(ACTIVE_CHANGED_CHANNEL, active)
  }
  window.on('focus', relay)
  window.on('blur', relay)
  window.on('minimize', relay)
  window.on('restore', relay)
  window.on('hide', relay)
  window.on('show', relay)
  const rendererId = window.webContents.id
  if (windowsByRendererId.size === 0) {
    ipcMain.handle(IS_ACTIVE_CHANNEL, isSenderWindowActive)
  }
  windowsByRendererId.set(rendererId, window)
  // Why only the handler: the window's own listeners go away with it.
  return {
    dispose: () => {
      if (windowsByRendererId.get(rendererId) !== window) {
        return
      }
      windowsByRendererId.delete(rendererId)
      if (windowsByRendererId.size === 0) {
        ipcMain.removeHandler(IS_ACTIVE_CHANNEL)
      }
    }
  }
}
