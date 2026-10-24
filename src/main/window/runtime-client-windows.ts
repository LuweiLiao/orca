import { app, BrowserWindow, nativeTheme, type Event } from 'electron'
import type { PersistedUIState } from '../../shared/persisted-ui-state-types'
import type { KeybindingOverrides } from '../../shared/keybindings'
import type { UIZoomDirection } from '../../shared/ui-zoom-level'
import { installRuntimeClientWindowShortcuts } from './runtime-client-window-shortcuts'
import { stepWebContentsZoom } from './window-zoom-shortcuts'
import { isWindowlessLaunch, showWindowWithoutStealingFocus } from './foreground-activation-policy'
import { installPrivilegedWindowNavigationPolicy } from './privileged-window-navigation'
import { rectHasVisibleAreaOnAnyDisplay, type WindowRect } from './window-bounds-validation'
import {
  lowestFreeRuntimeClientWindowSlot,
  readRuntimeClientWindowRecords,
  upsertRuntimeClientWindowRecord,
  type RuntimeClientWindowRecord
} from './runtime-client-window-records'
import {
  resolveRuntimeClientWindowEntry,
  withWorktreeFragment,
  type RuntimeClientWindowPairingHost
} from './runtime-client-window-pairing'

const MIN_WIDTH = 700
const MIN_HEIGHT = 520
const DEFAULT_WIDTH = 1280
const DEFAULT_HEIGHT = 860
const BOUNDS_SAVE_DEBOUNCE_MS = 500
// Why: the web client copies and pastes through navigator.clipboard; nothing else it does needs a grant.
const CLIENT_PERMISSIONS: ReadonlySet<string> = new Set([
  'clipboard-read',
  'clipboard-sanitized-write'
])

export type RuntimeClientWindowStore = {
  getUI: () => Pick<PersistedUIState, 'uiZoomLevel' | 'runtimeClientWindows'>
  updateUI: (updates: Pick<PersistedUIState, 'runtimeClientWindows'>) => void
  onUIChanged: (listener: (ui: Pick<PersistedUIState, 'uiZoomLevel'>) => void) => () => void
}

export type RuntimeClientWindowDeps = {
  getStore: () => RuntimeClientWindowStore | null
  getPairingHost: () => RuntimeClientWindowPairingHost | null
  isAppQuitting: () => boolean
  isServeMode: () => boolean
  getKeybindings?: () => KeybindingOverrides | undefined
  onNewWindowShortcut?: () => void
}

export type OpenRuntimeClientWindowResult =
  | { ok: true; slot: number; window: BrowserWindow }
  | { ok: false; reason: string }

export type RuntimeClientWindowInfo = { slot: number; window: BrowserWindow }

type LiveRuntimeClientWindow = RuntimeClientWindowInfo & { ownerClosing: boolean }

export type RuntimeClientWindowManager = {
  open: (options?: { worktreeId?: string }) => OpenRuntimeClientWindowResult
  restore: () => void
  closeAll: () => void
  list: () => RuntimeClientWindowInfo[]
}

export function createRuntimeClientWindowManager(
  deps: RuntimeClientWindowDeps
): RuntimeClientWindowManager {
  const live = new Map<number, LiveRuntimeClientWindow>()

  const readRecords = (store: RuntimeClientWindowStore): RuntimeClientWindowRecord[] =>
    readRuntimeClientWindowRecords(store.getUI().runtimeClientWindows)
  const patchRecord = (
    store: RuntimeClientWindowStore,
    slot: number,
    patch: Partial<Omit<RuntimeClientWindowRecord, 'slot'>>
  ): void =>
    store.updateUI({
      runtimeClientWindows: upsertRuntimeClientWindowRecord(readRecords(store), slot, patch)
    })

  const fail = (reason: string): OpenRuntimeClientWindowResult => {
    console.warn(`[runtime-client-window] Not opening a window: ${reason}`)
    return { ok: false, reason }
  }

  const openSlot = (
    slot: number,
    options: { worktreeId?: string; restoring: boolean }
  ): OpenRuntimeClientWindowResult => {
    const store = deps.getStore()
    const host = deps.getPairingHost()
    if (!store || !host) {
      return fail('runtime_unavailable')
    }
    const record = readRecords(store).find((candidate) => candidate.slot === slot)
    const entry = resolveRuntimeClientWindowEntry(host, record, slot)
    if (!entry.ok) {
      return fail(entry.reason)
    }
    patchRecord(store, slot, {
      deviceId: entry.deviceId,
      webClientOrigin: entry.webClientOrigin,
      open: true
    })

    const savedBounds = restorableBounds(record?.bounds)
    const window = new BrowserWindow({
      width: savedBounds?.width ?? DEFAULT_WIDTH,
      height: savedBounds?.height ?? DEFAULT_HEIGHT,
      ...(savedBounds ? { x: savedBounds.x, y: savedBounds.y } : {}),
      minWidth: MIN_WIDTH,
      minHeight: MIN_HEIGHT,
      title: 'Orca',
      show: false,
      autoHideMenuBar: true,
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0a0a' : '#ffffff',
      webPreferences: {
        // Why no preload: the web client reaches the runtime over its paired socket, not Orca IPC.
        sandbox: true,
        // Why persistent per slot: each window keeps its own pairing and active workspace in storage.
        partition: `persist:orca-client-window-${slot}`,
        webviewTag: false
      }
    })
    const liveEntry: LiveRuntimeClientWindow = { slot, window, ownerClosing: false }
    live.set(slot, liveEntry)
    // Why: app-menu accelerators target the main window; without a menu here the web client owns its keys.
    if (process.platform !== 'darwin') {
      window.setMenu(null)
    }

    const contents = window.webContents
    // Why: same-origin navigation stays in the web client; anything else goes to the system browser.
    installPrivilegedWindowNavigationPolicy(contents)
    installRuntimeClientWindowShortcuts(contents, {
      getKeybindings: () => deps.getKeybindings?.(),
      onNewWindow: () => deps.onNewWindowShortcut?.()
    })
    contents.session.setPermissionRequestHandler((_contents, permission, callback, details) =>
      callback(isClientPermission(permission, details.requestingUrl, entry.webClientOrigin))
    )
    contents.session.setPermissionCheckHandler((_contents, permission, requestingOrigin) =>
      isClientPermission(permission, requestingOrigin, entry.webClientOrigin)
    )
    // Why: Electron has no leave-page prompt, so a vetoed unload would leave the window uncloseable.
    contents.on('will-prevent-unload', (event) => event.preventDefault())

    contents.on('dom-ready', () => {
      if (!window.isDestroyed()) {
        contents.setZoomLevel(store.getUI().uiZoomLevel ?? 0)
      }
    })
    let lastFollowedZoomLevel = store.getUI().uiZoomLevel ?? 0
    const offUIChanged = store.onUIChanged((ui) => {
      const level = ui.uiZoomLevel ?? 0
      if (level !== lastFollowedZoomLevel && !window.isDestroyed()) {
        lastFollowedZoomLevel = level
        contents.setZoomLevel(level)
      }
    })

    window.once('ready-to-show', () => {
      if (window.isDestroyed() || isWindowlessLaunch()) {
        return
      }
      if (record?.isMaximized) {
        window.maximize()
      }
      // Why: windows restored at launch must not pull focus away from the main window.
      if (options.restoring) {
        window.showInactive()
      } else {
        showWindowWithoutStealingFocus(window)
      }
    })

    let boundsTimer: ReturnType<typeof setTimeout> | null = null
    let boundsFrozen = false
    const clearBoundsTimer = (): void => {
      if (boundsTimer) {
        clearTimeout(boundsTimer)
        boundsTimer = null
      }
    }
    const persistBounds = (): void => {
      if (boundsFrozen || window.isDestroyed() || window.isMinimized() || window.isFullScreen()) {
        return
      }
      if (window.isMaximized()) {
        patchRecord(store, slot, { isMaximized: true })
        return
      }
      const bounds = window.getBounds()
      // Why: teardown can report near-minimum bounds; never remember those as the window's size.
      if (bounds.width < MIN_WIDTH || bounds.height < MIN_HEIGHT) {
        return
      }
      patchRecord(store, slot, { bounds, isMaximized: false })
    }
    const scheduleBoundsSave = (): void => {
      clearBoundsTimer()
      boundsTimer = setTimeout(() => {
        boundsTimer = null
        persistBounds()
      }, BOUNDS_SAVE_DEBOUNCE_MS)
    }
    window.on('resize', scheduleBoundsSave)
    window.on('move', scheduleBoundsSave)
    window.on('maximize', scheduleBoundsSave)
    window.on('unmaximize', scheduleBoundsSave)
    // Why before-quit too: the updater strips 'close' listeners before it quits.
    const freezeBounds = (event?: Event): void => {
      if (event?.defaultPrevented) {
        return
      }
      boundsFrozen = true
      clearBoundsTimer()
    }
    window.on('close', freezeBounds)
    app.on('before-quit', freezeBounds)

    window.on('closed', () => {
      app.removeListener('before-quit', freezeBounds)
      clearBoundsTimer()
      offUIChanged()
      if (live.get(slot) === liveEntry) {
        live.delete(slot)
      }
      // Why: only a close the user chose ends the slot's session; owner close and quit restore it.
      if (!liveEntry.ownerClosing && !deps.isAppQuitting()) {
        patchRecord(store, slot, { open: false })
      }
    })

    window.loadURL(withWorktreeFragment(entry.url, options.worktreeId)).catch((error: unknown) => {
      // Why no URL in the log: a fresh pairing's credential rides in the fragment.
      console.warn(`[runtime-client-window] Window ${slot} failed to load the web client:`, error)
    })
    return { ok: true, slot, window }
  }

  return {
    open: (options = {}) => {
      if (deps.isAppQuitting()) {
        return fail('app_quitting')
      }
      const slot = lowestFreeRuntimeClientWindowSlot(new Set(live.keys()))
      return openSlot(slot, { worktreeId: options.worktreeId, restoring: false })
    },
    restore: () => {
      const store = deps.getStore()
      if (!store || deps.isServeMode() || deps.isAppQuitting()) {
        return
      }
      for (const record of readRecords(store)) {
        if (record.open && !live.has(record.slot)) {
          openSlot(record.slot, { restoring: true })
        }
      }
    },
    closeAll: () => {
      for (const entry of live.values()) {
        entry.ownerClosing = true
        if (!entry.window.isDestroyed()) {
          entry.window.close()
        }
      }
    },
    list: () =>
      [...live.values()]
        .filter((entry) => !entry.window.isDestroyed())
        .sort((a, b) => a.slot - b.slot)
        .map(({ slot, window }) => ({ slot, window }))
  }
}

function restorableBounds(bounds: WindowRect | undefined): WindowRect | null {
  if (
    bounds &&
    bounds.width >= MIN_WIDTH &&
    bounds.height >= MIN_HEIGHT &&
    rectHasVisibleAreaOnAnyDisplay(bounds, MIN_WIDTH / 2, MIN_HEIGHT / 2)
  ) {
    return bounds
  }
  if (bounds) {
    console.warn('[runtime-client-window] Discarding off-screen or near-minimum bounds:', bounds)
  }
  return null
}

function isClientPermission(permission: string, requestingUrl: string, origin: string): boolean {
  if (!CLIENT_PERMISSIONS.has(permission)) {
    return false
  }
  try {
    return new URL(requestingUrl).origin === origin
  } catch {
    return false
  }
}

let manager: RuntimeClientWindowManager | null = null

/** Desktop launch wires the live store and runtime RPC; until then every call is a no-op. */
export function configureRuntimeClientWindows(deps: RuntimeClientWindowDeps): void {
  manager = createRuntimeClientWindowManager(deps)
}

export function openRuntimeClientWindow(options?: {
  worktreeId?: string
}): OpenRuntimeClientWindowResult {
  if (!manager) {
    console.warn('[runtime-client-window] Not opening a window: not configured')
    return { ok: false, reason: 'not_configured' }
  }
  return manager.open(options)
}

/** Reopens the windows that were open when the app last quit or the main window closed. */
export function restoreRuntimeClientWindows(): void {
  manager?.restore()
}

/** Closes every extra window but keeps them marked open, so the next launch restores them. */
export function closeAllRuntimeClientWindows(): void {
  manager?.closeAll()
}

export function listRuntimeClientWindows(): RuntimeClientWindowInfo[] {
  return manager?.list() ?? []
}

export function isRuntimeClientWindow(window: Electron.BaseWindow | null | undefined): boolean {
  return Boolean(window) && listRuntimeClientWindows().some((entry) => entry.window === window)
}

/** Zooms the focused extra window itself; false when another window has focus. */
export function zoomRuntimeClientWindowIfFocused(direction: UIZoomDirection): boolean {
  const focused = BrowserWindow.getFocusedWindow()
  if (!focused || !isRuntimeClientWindow(focused)) {
    return false
  }
  stepWebContentsZoom(focused.webContents, direction)
  return true
}
