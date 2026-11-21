import { ipcMain, Notification, type BrowserWindow } from 'electron'
import { QUIT_RENDERER_ACK_TIMEOUT_MS } from '../../../shared/app-lifecycle/shutdown/quit-teardown-deadline'
import { translateMain } from '../../i18n/main-i18n'
import type { NativeSettingsProjection } from '../../core-desktop/native-settings-projection'
import { resolveWindowCloseAction } from './window-close-decision'
import type { CreateMainWindowOptions } from './main-window-contracts'
import type { MainWindowFocusLifecycle } from './main-window-focus-lifecycle'
import type { MainWindowStateLifecycle } from './main-window-state-lifecycle'
import { syncTrafficLightPosition } from './main-window-visual-lifecycle'
import { consumeUserQuitWindowClose } from './user-quit-window-close'
import {
  getWindowCloseInFlight,
  settleRendererPreparationBeforeClose,
  setWindowCloseInFlight
} from '../renderer-relays/native-unload-coordinator'
import { installNativeWindowControls } from '../native-windows/native-window-controls'

export function installMainWindowCloseLifecycle(args: {
  focus: MainWindowFocusLifecycle
  mainWindow: BrowserWindow
  opts?: CreateMainWindowOptions
  rendererWebContentsId: number
  state: MainWindowStateLifecycle
  nativeSettings: NativeSettingsProjection | null
}): { dispose: () => void } {
  const { focus, mainWindow, opts, rendererWebContentsId, state, nativeSettings } = args
  // Renderer confirms save/process guards through window:confirm-close.
  let windowCloseConfirmed = false
  const closeRequestReceivedChannel = 'window:close-request-received'
  const closeCancelledChannel = 'window:close-cancelled'
  let closeRequestSequence = 0
  let quitRendererAckRequestId: number | null = null
  const rendererWebContents = mainWindow.webContents
  let quitRendererAckTimer: ReturnType<typeof setTimeout> | null = null
  const clearQuitRendererAckTimer = (): void => {
    quitRendererAckRequestId = null
    if (quitRendererAckTimer) {
      clearTimeout(quitRendererAckTimer)
      quitRendererAckTimer = null
    }
  }
  const armQuitRendererAckTimer = (requestId: number): void => {
    quitRendererAckRequestId = requestId
    if (quitRendererAckTimer) {
      return
    }
    // will-quit waits for window close; bound frozen-renderer acknowledgement so Quit remains usable.
    quitRendererAckTimer = setTimeout(() => {
      quitRendererAckTimer = null
      quitRendererAckRequestId = null
      if (mainWindow.isDestroyed()) {
        return
      }
      console.warn('[window] Renderer did not acknowledge quit; destroying unresponsive window')
      state.freezeBoundsOnQuit()
      mainWindow.destroy()
    }, QUIT_RENDERER_ACK_TIMEOUT_MS)
    quitRendererAckTimer.unref?.()
  }
  let lastAcknowledgedRequestId = 0
  // First request of the tracked close; any later ack proves the page received that close.
  let trackedCloseFirstRequestId = 0
  const trackCloseRequest = (quitting: boolean): number => {
    const requestId = ++closeRequestSequence
    if (!getWindowCloseInFlight(rendererWebContents)) {
      trackedCloseFirstRequestId = requestId
    }
    setWindowCloseInFlight(rendererWebContents, { quitting })
    return requestId
  }
  const onCloseRequestReceived = (event: Electron.IpcMainEvent, requestId: unknown): void => {
    if (event.sender.id !== rendererWebContentsId) {
      return
    }
    if (typeof requestId === 'number' && requestId > lastAcknowledgedRequestId) {
      lastAcknowledgedRequestId = requestId
    }
    if (requestId === quitRendererAckRequestId) {
      clearQuitRendererAckTimer()
    }
  }

  // The renderer may already be waiting on a durable checkpoint.
  const sendCloseRequestAfterPreparation = (send: () => void): void => {
    const preparation = settleRendererPreparationBeforeClose(mainWindow.webContents)
    if (!preparation) {
      send()
      return
    }
    void preparation.then(() => {
      if (mainWindow.isDestroyed()) {
        return
      }
      // A renderer that died during the reload cannot answer; reenter close through the gone-renderer bypass.
      if (focus.isRendererProcessGone() || (mainWindow.webContents.isCrashed?.() ?? false)) {
        mainWindow.close()
        return
      }
      send()
    })
  }

  // Windows tray minimization owns close when enabled; callers must skip their normal close path.
  const hideToTrayIfEnabled = (): boolean => {
    const isRendererCrashed = mainWindow.webContents.isCrashed?.() ?? false
    if (
      process.platform !== 'win32' ||
      focus.isRendererProcessGone() ||
      isRendererCrashed ||
      opts?.getIsQuitting?.() === true ||
      nativeSettings?.getSettings().minimizeToTrayOnClose !== true
    ) {
      return false
    }
    mainWindow.hide()
    // Persist the one-time tray notice so later minimize actions stay quiet.
    if (nativeSettings.getUI().trayMinimizeNoticeShown !== true) {
      try {
        new Notification({
          title: 'Orca',
          body: translateMain(
            'tray.minimizeNotice.body',
            'Orca is still running in the system tray'
          )
        }).show()
      } catch {
        // Notification is best-effort — never block hiding the window.
      }
      void nativeSettings.requestCoreWrite({
        kind: 'ui',
        updates: { trayMinimizeNoticeShown: true }
      })
    }
    return true
  }

  mainWindow.on('close', (e) => {
    const userQuitClose = consumeUserQuitWindowClose(mainWindow)
    // Alt+F4/programmatic closes need the same tray guard as the custom X.
    if (!windowCloseConfirmed && !userQuitClose && hideToTrayIfEnabled()) {
      e.preventDefault()
      return
    }
    const isRendererCrashed = mainWindow.webContents.isCrashed?.() ?? false
    // Only gone/crashed renderers can bypass confirmation; hung-but-live renderers must answer (#5787).
    const closeAction = resolveWindowCloseAction({
      windowCloseConfirmed,
      rendererProcessGone: focus.isRendererProcessGone(),
      isRendererCrashed
    })
    if (closeAction !== 'request-confirmation') {
      // Confirmed close reenters here; truly gone renderers cannot answer and must remain closable.
      if (closeAction === 'allow-confirmed') {
        windowCloseConfirmed = false
      }
      // Freeze remembered bounds before teardown resize/move/unmaximize events can overwrite them.
      state.freezeBoundsOnQuit()
      return
    }
    e.preventDefault()
    const isQuitting = opts?.getIsQuitting?.() ?? false
    sendCloseRequestAfterPreparation(() => {
      const requestId = trackCloseRequest(isQuitting || userQuitClose)
      // User Quit on serve closes windows without quitting the host; still bound frozen-renderer acknowledgement.
      if (isQuitting || userQuitClose) {
        armQuitRendererAckTimer(requestId)
      }
      // The always-mounted App subscription can confirm even before a workspace exists (#5144).
      mainWindow.webContents.send('window:close-requested', {
        isQuitting,
        requestId
      })
    })
  })
  // A renderer that dies before confirming cannot answer; finish the close a gone renderer may bypass anyway.
  mainWindow.webContents.on('render-process-gone', () => {
    const close = getWindowCloseInFlight(rendererWebContents)
    if (!close || mainWindow.isDestroyed()) {
      return
    }
    setWindowCloseInFlight(rendererWebContents, null)
    // A page that never received an ordinary close (e.g. not yet subscribed after reload) was not closing.
    if (!close.quitting && lastAcknowledgedRequestId < trackedCloseFirstRequestId) {
      return
    }
    clearQuitRendererAckTimer()
    console.warn('[window] Renderer exited during a close request; destroying window')
    state.freezeBoundsOnQuit()
    mainWindow.destroy()
  })
  // A veto cancels quit; resume bounds persistence for subsequent user resizing.
  const abortQuit = (): void => {
    setWindowCloseInFlight(rendererWebContents, null)
    state.resumeBoundsPersistence()
    clearQuitRendererAckTimer()
    opts?.onQuitAborted?.()
  }
  mainWindow.webContents.on('will-prevent-unload', () => {
    abortQuit()
    mainWindow.webContents.send('window:unload-prevented')
  })
  // Renderer prompts never reach will-prevent-unload. IPC is ordered, so a cancel before the newest ack is stale.
  const onCloseCancelled = (event: Electron.IpcMainEvent): void => {
    if (
      event.sender.id !== rendererWebContentsId ||
      lastAcknowledgedRequestId !== closeRequestSequence
    ) {
      return
    }
    setWindowCloseInFlight(rendererWebContents, null)
    if (opts?.getIsQuitting?.() === true) {
      abortQuit()
    }
  }

  const onConfirmClose = (): void => {
    setWindowCloseInFlight(rendererWebContents, null)
    clearQuitRendererAckTimer()
    windowCloseConfirmed = true
    if (!mainWindow.isDestroyed()) {
      mainWindow.close()
    }
  }
  // Windows close from IPC can misfire; send the renderer close request directly.
  const onRequestClose = (): void => {
    if (mainWindow.isDestroyed()) {
      return
    }
    // Custom X bypasses native close; apply the tray guard here too.
    if (hideToTrayIfEnabled()) {
      return
    }
    sendCloseRequestAfterPreparation(() => {
      const requestId = trackCloseRequest(false)
      mainWindow.webContents.send('window:close-requested', { isQuitting: false, requestId })
    })
  }
  // Native windows share these channels; each window answers only its own renderer.
  const disposeControls = installNativeWindowControls({
    window: mainWindow,
    requestClose: onRequestClose,
    confirmClose: onConfirmClose,
    syncTrafficLights: (zoomFactor) => syncTrafficLightPosition(mainWindow, zoomFactor)
  })
  ipcMain.on(closeRequestReceivedChannel, onCloseRequestReceived)
  ipcMain.on(closeCancelledChannel, onCloseCancelled)

  const dispose = (): void => {
    clearQuitRendererAckTimer()
    disposeControls()
    ipcMain.removeListener(closeRequestReceivedChannel, onCloseRequestReceived)
    ipcMain.removeListener(closeCancelledChannel, onCloseCancelled)
  }
  return { dispose }
}
