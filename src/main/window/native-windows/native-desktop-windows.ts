import { app, BrowserWindow } from 'electron'
import {
  updateDesktopWindowState,
  type WindowStateStore
} from '../../persistence/desktop-windows/desktop-window-state'
import { readRuntimeClientWindowRecords } from './runtime-client-window-records'
import { preferredDesktopRenderer } from './desktop-renderer-registry'
import type { MainWindowOpenOptions } from '../main-window/main-window-contracts'

export type NativeDesktopWindowOpenOptions = Pick<MainWindowOpenOptions, 'windowId' | 'worktreeId'>

type WindowManagerDeps = {
  getStore: () => WindowStateStore | null
  openWindow: (options?: NativeDesktopWindowOpenOptions) => Promise<BrowserWindow>
  isQuitting: () => boolean
  isServeMode: () => boolean
}

export class NativeDesktopWindows {
  private readonly windows = new Map<string, BrowserWindow>()

  constructor(private readonly deps: WindowManagerDeps) {}

  startupId(): string {
    const store = this.deps.getStore()
    if (!store) {
      return 'desktop-0'
    }
    const ui = store.getUI()
    if (!ui.desktopWindows) {
      store.updateUI({
        desktopWindows: {
          'desktop-0': {
            open: true,
            bounds: ui.windowBounds ?? undefined,
            maximized: ui.windowMaximized
          },
          ...Object.fromEntries(
            readRuntimeClientWindowRecords(ui.runtimeClientWindows).map((record) => [
              `desktop-${record.slot}`,
              { open: record.open === true, bounds: record.bounds, maximized: record.isMaximized }
            ])
          )
        }
      })
    }
    return (
      Object.entries(store.getUI().desktopWindows ?? {}).find(
        ([id, state]) => state.open && !this.windows.has(id)
      )?.[0] ?? this.freeId()
    )
  }

  private freeId(): string {
    let slot = 0
    while (this.windows.has(`desktop-${slot}`)) {
      slot += 1
    }
    return `desktop-${slot}`
  }

  async open(
    options: { worktreeId?: string } = {}
  ): Promise<{ ok: true; window: BrowserWindow } | { ok: false; reason: string }> {
    if (this.deps.isQuitting()) {
      return { ok: false, reason: 'app_quitting' }
    }
    if (!this.deps.getStore()) {
      return { ok: false, reason: 'runtime_unavailable' }
    }
    try {
      return {
        ok: true,
        window: await this.deps.openWindow({ ...options, windowId: this.freeId() })
      }
    } catch (error) {
      console.warn('[native-windows] Failed to open a desktop window', error)
      return { ok: false, reason: 'open_failed' }
    }
  }

  register(window: BrowserWindow, id: string): void {
    const store = this.deps.getStore()
    this.windows.set(id, window)
    if (store) {
      updateDesktopWindowState(store, id, { open: true })
    }
    window.once('closed', () => {
      if (this.windows.get(id) !== window) {
        return
      }
      this.windows.delete(id)
      // This close triggers app.quit() below; keep it `open: true` so it restores next launch.
      const closureCausesQuit =
        this.windows.size === 0 && !this.deps.isServeMode() && process.platform !== 'darwin'
      if (store && !this.deps.isQuitting() && !closureCausesQuit) {
        updateDesktopWindowState(store, id, { open: false })
      }
      if (closureCausesQuit && !this.deps.isQuitting()) {
        app.quit()
      }
    })
  }

  restore(): void {
    if (this.deps.isServeMode() || this.deps.isQuitting()) {
      return
    }
    const records = this.deps.getStore()?.getUI().desktopWindows ?? {}
    for (const [id, record] of Object.entries(records)) {
      if (record.open && !this.windows.has(id)) {
        void this.deps
          .openWindow({ windowId: id })
          .catch((error: unknown) =>
            console.warn('[native-windows] Failed to restore a desktop window', error)
          )
      }
    }
  }

  preferred(): BrowserWindow | null {
    const renderer = preferredDesktopRenderer()
    return (
      (renderer ? BrowserWindow.fromWebContents(renderer) : null) ??
      [...this.windows.values()].find((window) => !window.isDestroyed()) ??
      null
    )
  }

  list(): BrowserWindow[] {
    return [...this.windows.values()].filter((window) => !window.isDestroyed())
  }
}

let manager: NativeDesktopWindows | null = null

export function configureNativeDesktopWindows(deps: WindowManagerDeps): NativeDesktopWindows {
  manager ??= new NativeDesktopWindows(deps)
  return manager
}

export function openNativeDesktopWindow(options?: {
  worktreeId?: string
}): Promise<{ ok: true; window: BrowserWindow } | { ok: false; reason: string }> {
  return manager?.open(options) ?? Promise.resolve({ ok: false, reason: 'not_configured' })
}

export function restoreNativeDesktopWindows(): void {
  manager?.restore()
}

export function preferredNativeDesktopWindow(): BrowserWindow | null {
  return manager?.preferred() ?? null
}

export function listNativeDesktopWindows(): BrowserWindow[] {
  return manager?.list() ?? []
}
