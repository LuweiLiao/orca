import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'

// oxlint-disable-next-line no-restricted-imports -- application handlers installed here move with the IPC registry, not the native window
import type { Store } from '../persistence/loading-store/store'
import type { NativeSettingsProjection } from '../core-desktop/native-settings-projection'
import {
  acknowledgePendingTccPromptNotice,
  consumePendingTccPromptNotice,
  dismissTccPromptNotice,
  releasePendingTccPromptNotice
} from '../macos-permissions/macos-tcc-prompt-notice'
import { browserManager } from '../browser/guest-lifecycle/manager/browser-manager'
import {
  hasSystemMediaAccess,
  requestSystemMediaAccess
} from '../browser/site-settings/permissions/browser-media-access'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { reloadWithRendererCheckpoint } from './renderer-relays/native-unload-coordinator'
import type { ClaudeRuntimeAuthPreparation } from '../claude-accounts/runtime-auth/runtime-auth-types'
import type { ClaudeAccountSelectionTarget } from '../claude-accounts/selection/runtime-selection'
import type { GetSelectedCodexHomePath } from '../ipc/pty/host-env/types'
import { registerRuntimeWindowLifecycle } from './runtime-window-lifecycle'
import {
  attachRuntimeServicesOnce,
  type MainWindowServiceOptions
} from '../startup/main-window/main-window-runtime-services'
import { attachMainWindowWorktreeWatchers } from '../ipc/worktrees/main-window-worktree-watchers'
import { desktopWindowId, listDesktopRenderers } from './native-windows/desktop-renderer-registry'
import { registerNativeWindowServiceHandlers } from './native-windows/native-window-service-handlers'
import { NativeDesktopPtyDelivery } from '../ipc/pty/delivery/native-desktop-delivery'
import { ensureStructuredAgentSessionHostUnlessRefused } from '../runtime/agent-session/installation/structured-agent-session-host-refusal'
import { getAgentSessionAttachmentStore } from '../native-chat/agent-session-attachments/agent-session-attachment-store-registry'
import { registerDroppedPathPreparation } from './file-drop/dropped-path-preparation-ipc'
import { isPluginFramePermissionRequest } from './security/host-frame-permission-policy'
import { installPluginDesktopFrameServices } from '../plugins/panels/desktop-actions/plugin-frame-desktop-services'

let appReloadHandlerTokenCounter = 0
let activeAppReloadHandlerToken: number | null = null
let tccPromptHandlerTokenCounter = 0
let activeTccPromptHandlerToken: number | null = null
// Native desktop windows share one runtime: its handlers and PTY source attach once.
const attachedNativeRuntimes = new WeakSet<OrcaRuntimeService>()
const nativeDeliveries = new WeakMap<OrcaRuntimeService, NativeDesktopPtyDelivery>()

export async function attachMainWindowServices(
  mainWindow: BrowserWindow,
  store: Store,
  nativeSettings: NativeSettingsProjection,
  runtime: OrcaRuntimeService,
  getSelectedCodexHomePath?: GetSelectedCodexHomePath,
  prepareClaudeAuth?: (
    target?: ClaudeAccountSelectionTarget
  ) => Promise<ClaudeRuntimeAuthPreparation>,
  options?: MainWindowServiceOptions
): Promise<void> {
  const native = Boolean(desktopWindowId(mainWindow.webContents))
  let delivery = nativeDeliveries.get(runtime)
  if (native) {
    delivery ??= new NativeDesktopPtyDelivery(runtime, () => store.getSettings())
    nativeDeliveries.set(runtime, delivery)
    delivery.add(mainWindow)
    registerNativeWindowServiceHandlers(mainWindow, options?.onBeforeRendererReload)
  } else {
    registerAppReloadHandler(mainWindow, options?.onBeforeRendererReload)
  }
  attachMainWindowWorktreeWatchers(store, mainWindow)
  if (!native || !attachedNativeRuntimes.has(runtime)) {
    // Window attachment is serialized, so a failed attach leaves the next window to retry.
    await attachRuntimeServicesOnce(mainWindow, store, nativeSettings, runtime, delivery, {
      getSelectedCodexHomePath,
      prepareClaudeAuth,
      options
    })
    if (native) {
      attachedNativeRuntimes.add(runtime)
    }
  }
  registerDroppedPathPreparation(mainWindow, async () => {
    await ensureStructuredAgentSessionHostUnlessRefused(() =>
      runtime.ensureStructuredAgentSessionHost()
    )
    return getAgentSessionAttachmentStore()
  })
  if (!native) {
    registerTccPromptNoticeHandlers(mainWindow)
  } else {
    mainWindow.on('focus', () => browserManager.selectNativeRenderer(mainWindow.webContents.id))
  }
  registerRuntimeWindowLifecycle(mainWindow, runtime)

  installPluginDesktopFrameServices(mainWindow, store)
  const allowedPermissions = new Set(['media', 'fullscreen', 'pointerLock'])
  mainWindow.webContents.session.setPermissionRequestHandler(
    (_webContents, permission, callback, details) => {
      // Plugin srcdoc frames share this session but never the app's trust.
      if (isPluginFramePermissionRequest(details)) {
        callback(false)
        return
      }
      if (permission === 'media') {
        void requestSystemMediaAccess(details).then(callback, (error: unknown) => {
          console.error('[permissions] Failed to request media access:', error)
          callback(false)
        })
        return
      }
      callback(allowedPermissions.has(permission))
    }
  )
  mainWindow.webContents.session.setPermissionCheckHandler(
    (webContents, permission, _origin, details) => {
      // Electron's typings omit 'local-fonts', which Chromium checks before queryLocalFonts().
      const permissionName: string = permission
      // Only the app frame's font picker may list fonts; not subframes or other default-session pages.
      if (permissionName === 'local-fonts') {
        return webContents?.id === mainWindow.webContents.id && details.isMainFrame === true
      }
      if (permission !== 'media') {
        return allowedPermissions.has(permission)
      }
      return hasSystemMediaAccess(details?.mediaType)
    }
  )

  mainWindow.on('closed', () => {
    // Drop guest registrations so stale tab/webContents IDs cannot survive close or hot reload.
    if (!native || listDesktopRenderers().length === 0) {
      browserManager.unregisterAll()
    }
  })
}

function registerTccPromptNoticeHandlers(mainWindow: BrowserWindow): void {
  const handlerToken = ++tccPromptHandlerTokenCounter
  if (activeTccPromptHandlerToken !== null) {
    releasePendingTccPromptNotice(activeTccPromptHandlerToken)
  }
  activeTccPromptHandlerToken = handlerToken
  const consumeChannel = 'macosTccPrompts:consumePending'
  const acknowledgeChannel = 'macosTccPrompts:acknowledgePending'
  const releaseChannel = 'macosTccPrompts:releasePending'
  const dismissChannel = 'macosTccPrompts:dismiss'
  ipcMain.removeHandler(consumeChannel)
  ipcMain.removeHandler(acknowledgeChannel)
  ipcMain.removeHandler(releaseChannel)
  ipcMain.removeHandler(dismissChannel)
  const mainWebContents = mainWindow.webContents
  const releaseOwnerClaim = (): void => releasePendingTccPromptNotice(handlerToken)
  // Reload/crash destroys renderer claim callbacks without closing the window.
  mainWebContents.on('did-start-loading', () => {
    if (mainWebContents.isLoadingMainFrame()) {
      releaseOwnerClaim()
    }
  })
  mainWebContents.on('render-process-gone', releaseOwnerClaim)
  const ownsNotice = (event: IpcMainInvokeEvent): boolean =>
    !mainWindow.isDestroyed() && !mainWebContents.isDestroyed() && event.sender === mainWebContents
  ipcMain.handle(consumeChannel, (event) =>
    ownsNotice(event) ? consumePendingTccPromptNotice(handlerToken) : null
  )
  ipcMain.handle(acknowledgeChannel, (event, claimId: number) => {
    if (ownsNotice(event) && Number.isSafeInteger(claimId)) {
      acknowledgePendingTccPromptNotice(handlerToken, claimId)
    }
  })
  ipcMain.handle(releaseChannel, (event, claimId: number) => {
    if (ownsNotice(event) && Number.isSafeInteger(claimId)) {
      releasePendingTccPromptNotice(handlerToken, claimId)
    }
  })
  ipcMain.handle(dismissChannel, (event) => {
    if (ownsNotice(event)) {
      dismissTccPromptNotice()
    }
  })
  // Windowless macOS must release closures; late old-window close must not clear replacement handlers.
  mainWindow.on('closed', () => {
    if (activeTccPromptHandlerToken !== handlerToken) {
      return
    }
    releaseOwnerClaim()
    ipcMain.removeHandler(consumeChannel)
    ipcMain.removeHandler(acknowledgeChannel)
    ipcMain.removeHandler(releaseChannel)
    ipcMain.removeHandler(dismissChannel)
    activeTccPromptHandlerToken = null
  })
}

function registerAppReloadHandler(
  mainWindow: BrowserWindow,
  onBeforeRendererReload?: (args: { webContentsId: number; ignoreCache: boolean }) => void
): void {
  // Process-global IPC outlives windows; guard both window and WebContents lifetimes.
  const handlerToken = ++appReloadHandlerTokenCounter
  activeAppReloadHandlerToken = handlerToken
  const mainWebContents = mainWindow.webContents
  ipcMain.removeHandler('app:reload')
  ipcMain.handle('app:reload', (event) => {
    if (
      mainWindow.isDestroyed() ||
      mainWebContents.isDestroyed() ||
      event.sender !== mainWebContents
    ) {
      return
    }
    return reloadWithRendererCheckpoint(mainWebContents, false, onBeforeRendererReload)
  })
  mainWindow.on('closed', () => {
    if (activeAppReloadHandlerToken !== handlerToken) {
      return
    }
    // Remove the process-global handler so windowless macOS does not retain a closed window.
    ipcMain.removeHandler('app:reload')
    activeAppReloadHandlerToken = null
  })
}
