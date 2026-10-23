import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'

const mocks = vi.hoisted(() => ({
  contents: new Map<number, WebContents>(),
  natives: new Set<number>()
}))
vi.mock('electron', () => ({
  app: { getPath: () => '/downloads' },
  BrowserWindow: { fromWebContents: () => null },
  clipboard: { writeText: vi.fn() },
  shell: { openExternal: vi.fn() },
  Menu: { buildFromTemplate: () => ({ popup: vi.fn() }) },
  screen: { getCursorScreenPoint: () => ({ x: 0, y: 0 }) },
  webContents: { fromId: (id: number) => mocks.contents.get(id) ?? null }
}))
vi.mock('../window/desktop-renderer-registry', () => ({
  desktopWindowId: (renderer: { id: number }) =>
    mocks.natives.has(renderer.id) ? `native-${renderer.id}` : null
}))
vi.mock('./popup-origin-bar-window', () => ({ openPopupWithOriginBar: vi.fn() }))

import { BrowserManager } from './browser-manager'
import { DestroyedGuestTestContents } from './browser-manager-destroyed-guest-test-fixture'
import { createDownloadItem } from './browser-manager-test-harness'

class Renderer extends DestroyedGuestTestContents {
  send = vi.fn()
}
const manager = new BrowserManager()

function fixture() {
  const first = new Renderer(5001)
  const second = new Renderer(5002)
  for (const renderer of [first, second]) {
    mocks.contents.set(renderer.id, renderer.asWebContents())
    mocks.natives.add(renderer.id)
  }
  const a = new DestroyedGuestTestContents(101)
  const b = new DestroyedGuestTestContents(102)
  for (const [guest, renderer] of [
    [a, first],
    [b, second]
  ] as const) {
    mocks.contents.set(guest.id, guest.asWebContents())
    manager.attachGuestPolicies(guest.asWebContents())
    expect(
      manager.registerGuest({
        browserPageId: 'shared-page',
        workspaceId: 'workspace',
        worktreeId: 'worktree',
        webContentsId: guest.id,
        rendererWebContentsId: renderer.id
      })
    ).toBe(true)
  }
  return { first, second, a, b }
}

afterEach(() => {
  manager.unregisterAll()
  mocks.contents.clear()
  mocks.natives.clear()
})

describe('native browser page guests', () => {
  it('keeps both guest policies and shortcut owners across selection and either guest closing', () => {
    const { first, second, a, b } = fixture()
    expect(manager.getManagedBrowserGuestContext(a.id)?.browserPageId).toBe('shared-page')
    expect(manager.getManagedBrowserGuestContext(b.id)?.browserPageId).toBe('shared-page')
    expect(manager.getRendererContextForGuest(a.id)?.renderer.id).toBe(first.id)
    expect(manager.getRendererContextForGuest(b.id)?.renderer.id).toBe(second.id)
    const input = {
      type: 'keyDown',
      code: 'KeyL',
      key: 'l',
      control: process.platform !== 'darwin',
      meta: process.platform === 'darwin',
      alt: false,
      shift: false
    }
    a.emit('before-input-event', { preventDefault: vi.fn() }, input)
    expect(first.send).toHaveBeenCalled()
    expect(second.send).not.toHaveBeenCalled()
    manager.selectNativeRenderer(first.id)
    expect(manager.getGuestWebContentsId('shared-page')).toBe(a.id)
    b.destroy()
    expect(manager.getGuestWebContentsId('shared-page')).toBe(a.id)
    expect(manager.getManagedBrowserGuestContext(a.id)?.browserPageId).toBe('shared-page')
    a.destroy()
    expect(manager.getGuestWebContentsId('shared-page')).toBeNull()
  })

  it('keeps the second native guest when the first unregisters and routes downloads to their own renderer', () => {
    const { first, second, a, b } = fixture()
    const item = createDownloadItem()
    const peerItem = createDownloadItem({ getFilename: () => 'peer.csv' })
    manager.handleGuestWillDownload({ guestWebContentsId: b.id, item: peerItem })
    second.send.mockClear()
    manager.handleGuestWillDownload({ guestWebContentsId: a.id, item })
    expect(first.send).toHaveBeenCalledWith(
      'browser:download-requested',
      expect.objectContaining({ browserPageId: 'shared-page' })
    )
    expect(second.send).not.toHaveBeenCalledWith('browser:download-requested', expect.anything())
    manager.selectNativeRenderer(first.id)
    manager.unregisterGuest('shared-page')
    expect(manager.getGuestWebContentsId('shared-page')).toBe(b.id)
    expect(manager.getRendererContextForGuest(b.id)?.renderer.id).toBe(second.id)
    expect(manager.getManagedBrowserGuestContext(b.id)?.browserPageId).toBe('shared-page')
    expect(peerItem.cancel).not.toHaveBeenCalled()
  })
})
