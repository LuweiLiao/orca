import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import type { DeviceEntry } from '../runtime/device-entry'
import type { PersistedUIState } from '../../shared/persisted-ui-state-types'

const { instances, BrowserWindowMock, getAllDisplaysMock } = vi.hoisted(() => {
  const created: FakeWindow[] = []

  class FakeWindow {
    options: Electron.BrowserWindowConstructorOptions
    private handlers: Record<string, ((...args: unknown[]) => void)[]> = {}
    destroyed = false
    maximized = false
    bounds = { x: 0, y: 0, width: 1280, height: 860 }
    webContents = {
      session: { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn() },
      on: vi.fn(),
      setZoomLevel: vi.fn()
    }
    show = vi.fn()
    showInactive = vi.fn()
    setMenu = vi.fn()
    maximize = vi.fn(() => {
      this.maximized = true
    })
    loadURL = vi.fn((_url: string) => Promise.resolve())
    close = vi.fn(() => {
      this.emit('close')
      this.destroyed = true
      this.emit('closed')
    })

    constructor(options: Electron.BrowserWindowConstructorOptions) {
      this.options = options
      created.push(this)
    }

    on(event: string, cb: (...args: unknown[]) => void): this {
      ;(this.handlers[event] ||= []).push(cb)
      return this
    }

    once(event: string, cb: (...args: unknown[]) => void): this {
      return this.on(event, cb)
    }

    emit(event: string, ...args: unknown[]): void {
      for (const cb of this.handlers[event] ?? []) {
        cb(...args)
      }
    }

    isDestroyed(): boolean {
      return this.destroyed
    }
    isMinimized(): boolean {
      return false
    }
    isFullScreen(): boolean {
      return false
    }
    isMaximized(): boolean {
      return this.maximized
    }
    getBounds(): { x: number; y: number; width: number; height: number } {
      return this.bounds
    }
  }

  return {
    instances: created,
    BrowserWindowMock: FakeWindow,
    getAllDisplaysMock: vi.fn(() => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }])
  }
})

vi.mock('electron', () => ({
  app: { on: vi.fn(), removeListener: vi.fn() },
  BrowserWindow: BrowserWindowMock,
  nativeTheme: { shouldUseDarkColors: true },
  screen: { getAllDisplays: getAllDisplaysMock },
  shell: { openExternal: vi.fn() }
}))
vi.mock('./privileged-window-navigation', () => ({
  installPrivilegedWindowNavigationPolicy: vi.fn()
}))

import {
  createRuntimeClientWindowManager,
  type RuntimeClientWindowStore
} from './runtime-client-windows'
import type { RuntimeClientWindowPairingHost } from './runtime-client-window-pairing'

const ORIGIN = 'http://127.0.0.1:6768'
const ENTRY_URL = `${ORIGIN}/web-index.html`

type StoredUI = Pick<PersistedUIState, 'uiZoomLevel' | 'runtimeClientWindows'>

function makeStore(initial: Partial<StoredUI> = {}): RuntimeClientWindowStore & {
  ui: () => StoredUI
} {
  let ui: StoredUI = { uiZoomLevel: 0, ...initial }
  return {
    getUI: () => ui,
    updateUI: (updates) => {
      ui = { ...ui, ...updates }
    },
    onUIChanged: () => () => {},
    ui: () => ui
  }
}

// Mints a fresh row on every offer, the worst case a pairing host could produce.
function makeHost(options: { unavailable?: boolean; noWebClient?: boolean } = {}) {
  const devices: DeviceEntry[] = []
  let minted = 0
  const createPairingOffer = vi.fn<RuntimeClientWindowPairingHost['createPairingOffer']>((args) => {
    if (options.unavailable) {
      return {
        available: false,
        reason: 'websocket_unavailable',
        guidance: 'WebSocket pairing is unavailable.'
      }
    }
    minted += 1
    const deviceId = `device-${minted}`
    devices.push({
      deviceId,
      name: args.name,
      token: `token-${deviceId}`,
      scope: 'runtime',
      pairedAt: 1,
      lastSeenAt: 0
    })
    return {
      available: true,
      pairingUrl: `orca://pair#${deviceId}`,
      endpoint: 'ws://127.0.0.1:6768',
      deviceId,
      webClientUrl: options.noWebClient
        ? null
        : `${ENTRY_URL}#pairing=${encodeURIComponent(`orca://pair#${deviceId}`)}`
    }
  })
  const host: RuntimeClientWindowPairingHost = {
    createPairingOffer,
    getDeviceRegistry: () => ({
      getDevice: (deviceId) => devices.find((device) => device.deviceId === deviceId) ?? null,
      listDevices: () => devices
    }),
    getWebClientEntryUrl: () => ENTRY_URL
  }
  // The web client's first connect forks the token row into a keyed row, as device-key-fork does.
  const clientConnected = (deviceId: string): void => {
    devices.push({
      deviceId: `${deviceId}-key`,
      name: 'browser',
      scope: 'runtime',
      pairedAt: 2,
      lastSeenAt: 2,
      credentialKind: 'device-key',
      devicePublicKeyB64: 'key',
      forkedFrom: deviceId
    })
  }
  return { host, devices, createPairingOffer, clientConnected }
}

function makeManager(
  store: RuntimeClientWindowStore,
  host: RuntimeClientWindowPairingHost,
  flags: { quitting?: boolean } = {}
) {
  return createRuntimeClientWindowManager({
    getStore: () => store,
    getPairingHost: () => host,
    isAppQuitting: () => flags.quitting === true,
    isServeMode: () => false
  })
}

let warn: MockInstance<typeof console.warn>

// These cases exercise foreground behavior against Electron mocks.
beforeEach(() => {
  instances.length = 0
  vi.stubEnv('ORCA_BACKGROUND_LAUNCH', undefined)
  vi.stubEnv('ORCA_E2E_HEADLESS', undefined)
  vi.stubEnv('ORCA_E2E_HEADFUL', undefined)
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllEnvs()
  warn.mockRestore()
})

describe('runtime client windows', () => {
  it('numbers slots from 1 and reuses the lowest closed slot with its own partition', () => {
    const manager = makeManager(makeStore(), makeHost().host)

    const slots = [manager.open(), manager.open(), manager.open()].map((r) => r.ok && r.slot)
    expect(slots).toEqual([1, 2, 3])
    instances[1].close()
    const reopened = manager.open()

    expect(reopened.ok && reopened.slot).toBe(2)
    expect(instances.map((window) => window.options.webPreferences?.partition)).toEqual([
      'persist:orca-client-window-1',
      'persist:orca-client-window-2',
      'persist:orca-client-window-3',
      'persist:orca-client-window-2'
    ])
    expect(manager.list().map((entry) => entry.slot)).toEqual([1, 2, 3])
  })

  it('reopens a paired slot from its stored pairing without minting another device', () => {
    const store = makeStore()
    const { host, devices, createPairingOffer, clientConnected } = makeHost()
    const manager = makeManager(store, host)

    manager.open({ worktreeId: 'repo/wt 1' })
    expect(instances[0].loadURL.mock.calls[0][0]).toBe(
      `${ENTRY_URL}#pairing=${encodeURIComponent('orca://pair#device-1')}&worktree=repo%2Fwt%201`
    )
    clientConnected('device-1')
    const rowsAfterPairing = devices.length

    for (let round = 0; round < 3; round += 1) {
      instances.at(-1)?.close()
      manager.open({ worktreeId: 'wt-2' })
    }

    expect(createPairingOffer).toHaveBeenCalledTimes(1)
    expect(devices).toHaveLength(rowsAfterPairing)
    expect(instances.at(-1)?.loadURL.mock.calls[0][0]).toBe(`${ENTRY_URL}#worktree=wt-2`)

    // A revoked grant means the stored pairing is dead, so the slot pairs again.
    devices.splice(0)
    instances.at(-1)?.close()
    manager.open()
    expect(createPairingOffer).toHaveBeenCalledTimes(2)
    expect(store.ui().runtimeClientWindows?.[0]?.deviceId).toBe('device-2')
  })

  it.each([
    ['pairing is unavailable', { unavailable: true }, 'websocket_unavailable'],
    ['the web client is not served', { noWebClient: true }, 'web_client_unavailable']
  ])('opens no window when %s', (_case, hostOptions, reasonPrefix) => {
    const store = makeStore()
    const result = makeManager(store, makeHost(hostOptions).host).open()

    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason.startsWith(reasonPrefix)).toBe(true)
    expect(instances).toHaveLength(0)
    expect(store.ui().runtimeClientWindows).toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(reasonPrefix))
  })

  it('restores saved bounds only when they are visible on a current display', () => {
    const store = makeStore({
      runtimeClientWindows: [
        { slot: 1, open: true, bounds: { x: 200, y: 100, width: 1000, height: 700 } },
        { slot: 2, open: true, bounds: { x: 5000, y: 5000, width: 1000, height: 700 } }
      ]
    })
    makeManager(store, makeHost().host).restore()

    expect(instances[0].options).toMatchObject({ x: 200, y: 100, width: 1000, height: 700 })
    expect(instances[1].options).toMatchObject({ width: 1280, height: 860 })
    expect(instances[1].options.x).toBeUndefined()
  })

  type EndSession = (manager: ReturnType<typeof makeManager>, flags: { quitting: boolean }) => void
  const closeMainWindow: EndSession = (manager) => manager.closeAll()
  const quitApp: EndSession = (_manager, flags) => {
    flags.quitting = true
    instances.forEach((window) => window.close())
  }
  it.each([
    ['the main window closes', closeMainWindow],
    ['the app quits', quitApp]
  ])('keeps windows marked open when %s and restores them inactive next launch', (_case, end) => {
    const store = makeStore()
    const { host, clientConnected } = makeHost()
    const flags = { quitting: false }
    const manager = makeManager(store, host, flags)
    manager.open()
    manager.open()
    clientConnected('device-1')
    clientConnected('device-2')
    instances[1].bounds = { x: 300, y: 200, width: 900, height: 650 }
    vi.useFakeTimers()
    try {
      instances[1].emit('move')
      vi.advanceTimersByTime(500)
    } finally {
      vi.useRealTimers()
    }

    end(manager, flags)
    expect(instances.every((window) => window.destroyed)).toBe(true)
    expect(manager.list()).toEqual([])

    instances.length = 0
    makeManager(store, host).restore()
    expect(instances.map((window) => window.options.webPreferences?.partition)).toEqual([
      'persist:orca-client-window-1',
      'persist:orca-client-window-2'
    ])
    expect(instances[1].options).toMatchObject({ x: 300, y: 200, width: 900, height: 650 })
    instances[0].emit('ready-to-show')
    expect(instances[0].showInactive).toHaveBeenCalledTimes(1)
    expect(instances[0].show).not.toHaveBeenCalled()
  })

  it('does not restore a window the user closed', () => {
    const store = makeStore()
    const { host } = makeHost()
    const manager = makeManager(store, host)
    manager.open()
    manager.open()

    instances[0].close()
    manager.closeAll()
    instances.length = 0
    makeManager(store, host).restore()

    expect(instances.map((window) => window.options.webPreferences?.partition)).toEqual([
      'persist:orca-client-window-2'
    ])
  })
})
