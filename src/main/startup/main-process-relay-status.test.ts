import { afterEach, expect, it, vi } from 'vitest'

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  let nextId = 0
  class Contents extends EventEmitter {
    id = ++nextId
    private destroyed = false
    isDestroyed = (): boolean => this.destroyed
    getType = (): string => 'window'
    send = vi.fn(() => {
      if (this.destroyed) {
        throw new TypeError('Object has been destroyed')
      }
    })
    destroy = (): void => {
      this.destroyed = true
      this.emit('destroyed')
    }
  }
  class Window {
    webContents = new Contents()
    destroy = (): void => this.webContents.destroy()
  }
  return { BrowserWindow: Window }
})

vi.mock('./main-process-state', () => ({
  mainProcessState: {
    mainWindow: null,
    desktopRelayStatus: 'offline',
    desktopRelayCellUrl: undefined
  }
}))

import { BrowserWindow } from 'electron'
import { mainProcessState as state } from './main-process-state'
import { getDesktopRelayStatus, publishDesktopRelayStatus } from './main-process-relay-status'
import {
  listDesktopRenderers,
  registerDesktopRenderer,
  unregisterDesktopRenderer
} from '../window/desktop-renderer-registry'

afterEach(() => {
  for (const renderer of listDesktopRenderers()) {
    unregisterDesktopRenderer(renderer)
  }
  state.mainWindow = null
})

it('publishes relay status after the main window is destroyed', () => {
  const mainWindow = new BrowserWindow({ show: false })
  const survivingWindow = new BrowserWindow({ show: false })
  state.mainWindow = mainWindow
  registerDesktopRenderer(mainWindow.webContents)
  registerDesktopRenderer(survivingWindow.webContents)
  mainWindow.destroy()

  expect(() => publishDesktopRelayStatus('offline')).not.toThrow()
  expect(getDesktopRelayStatus()).toEqual({ status: 'offline' })
  expect(survivingWindow.webContents.send).toHaveBeenCalledWith('mobile:relayStatusChanged', {
    status: 'offline'
  })

  survivingWindow.destroy()
  expect(() => publishDesktopRelayStatus('offline')).not.toThrow()
})
