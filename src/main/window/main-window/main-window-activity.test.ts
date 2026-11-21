import { describe, expect, it, vi } from 'vitest'

const { handlers } = vi.hoisted(() => ({
  handlers: new Map<string, (event: { sender: { id: number } }) => unknown>()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: { sender: { id: number } }) => unknown) => {
      if (handlers.has(channel)) {
        throw new Error(`Attempted to register a second handler for '${channel}'`)
      }
      handlers.set(channel, handler)
    },
    removeHandler: (channel: string) => handlers.delete(channel)
  }
}))

import { installMainWindowActivityRelay, type ActivityWindow } from './main-window-activity'

function activityWindow(id: number, focused: boolean): ActivityWindow {
  return {
    isDestroyed: () => false,
    isFocused: () => focused,
    isVisible: () => true,
    isMinimized: () => false,
    on: () => undefined,
    webContents: { id, isDestroyed: () => false, send: () => undefined }
  }
}

describe('installMainWindowActivityRelay', () => {
  it('answers each native window about itself and keeps the channel until the last closes', () => {
    const first = installMainWindowActivityRelay(activityWindow(1, false))
    const second = installMainWindowActivityRelay(activityWindow(2, true))
    const isActive = (id: number) => handlers.get('window:isActive')?.({ sender: { id } })

    expect(isActive(1)).toBe(false)
    expect(isActive(2)).toBe(true)

    first.dispose()
    expect(isActive(1)).toBe(false)
    expect(isActive(2)).toBe(true)

    second.dispose()
    expect(handlers.has('window:isActive')).toBe(false)
  })
})
