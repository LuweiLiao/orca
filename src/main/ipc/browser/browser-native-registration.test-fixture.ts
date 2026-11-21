import { expect, it, vi } from 'vitest'
import { registerBrowserHandlers, setAgentBrowserBridgeRef } from './browser'
import { browserManager } from '../../browser/guest-lifecycle/manager/browser-manager'

export function nativeRegistrationRegressions(mocks: {
  handleMock: ReturnType<typeof vi.fn>
  getGuestWebContentsIdMock: ReturnType<typeof vi.fn>
  getTabIdForWebContentsIdMock: ReturnType<typeof vi.fn>
  getWorktreeIdForTabMock: ReturnType<typeof vi.fn>
}): void {
  it('updates the bridge active tab for the owning worktree', () => {
    const bridge = {
      onProcessSwap: vi.fn(async () => {}),
      onTabClosed: vi.fn(async () => {}),
      onTabChanged: vi.fn(),
      onPageClosed: vi.fn(async () => {})
    }
    mocks.getGuestWebContentsIdMock.mockReturnValue(4242)
    mocks.getWorktreeIdForTabMock.mockReturnValue('wt-browser')
    setAgentBrowserBridgeRef(bridge)
    registerBrowserHandlers({ getSettings: vi.fn() })
    const handler: unknown = mocks.handleMock.mock.calls.find(
      ([channel]) => channel === 'browser:activeTabChanged'
    )?.[1]
    if (typeof handler !== 'function') {
      throw new Error('No active browser handler')
    }
    expect(
      handler(
        {
          sender: {
            id: 91,
            isDestroyed: () => false,
            getType: () => 'window',
            getURL: () => 'file:///renderer/index.html'
          }
        },
        { browserPageId: 'page-1' }
      )
    ).toBe(true)
    expect(bridge.onTabChanged).toHaveBeenCalledWith(4242, 'wt-browser')
    // activeTabChanged is explicit activation: it is the one caller allowed to move the shared selection.
    expect(vi.mocked(browserManager.selectNativeRenderer)).toHaveBeenCalledWith(91)
  })

  it.each([true, false])(
    'retires automation only for a replaced guest; retained=%s',
    (retained) => {
      const bridge = {
        onProcessSwap: vi.fn(async () => {}),
        onTabClosed: vi.fn(async () => {}),
        onTabChanged: vi.fn(),
        onPageClosed: vi.fn(async () => {})
      }
      setAgentBrowserBridgeRef(bridge)
      mocks.getGuestWebContentsIdMock.mockReturnValue(101)
      mocks.getTabIdForWebContentsIdMock.mockReturnValue(retained ? 'shared' : null)
      registerBrowserHandlers({ getSettings: vi.fn() })
      const handler: unknown = mocks.handleMock.mock.calls.find(
        ([channel]) => channel === 'browser:registerGuest'
      )?.[1]
      if (typeof handler !== 'function') {
        throw new Error('No guest registration handler')
      }
      const renderer = {
        id: 91,
        isDestroyed: () => false,
        getType: () => 'window',
        getURL: () => 'file:///renderer/index.html'
      }
      expect(
        handler(
          { sender: renderer },
          {
            browserPageId: 'shared',
            workspaceId: 'workspace',
            worktreeId: 'worktree',
            webContentsId: 102
          }
        )
      ).toBe(true)
      if (retained) {
        expect(bridge.onProcessSwap).not.toHaveBeenCalled()
      } else {
        expect(bridge.onProcessSwap).toHaveBeenCalledWith('shared', 102, 101)
      }
    }
  )
}
