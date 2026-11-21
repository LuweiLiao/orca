import { webContents } from 'electron'
import type { PopupOwnerContext } from '../popups/browser-popup-ownership'
import { BrowserManagerViewportScrollState } from './viewport/browser-manager-viewport-scroll-state'

/** Native desktop windows can each mount a guest of one page; events route to the owning window. */
export abstract class BrowserManagerNativeRenderers extends BrowserManagerViewportScrollState {
  protected readonly nativeRendererByGuestId = new Map<number, number>()
  protected abstract selectGuestForEvent(guestId: number): void
  protected abstract resolvePopupOwnerContext(guestWebContentsId: number): PopupOwnerContext | null

  protected override guestIdForRenderer(pageId: string, rendererId: number): number | undefined {
    return this.rendererWebContentsIdByTabId.get(pageId) === rendererId
      ? this.webContentsIdByTabId.get(pageId)
      : undefined
  }

  protected annotationViewportBridgeKey(pageId: string, guestId: number): string {
    const rendererId = this.nativeRendererByGuestId.get(guestId)
    return rendererId === undefined ? pageId : `${rendererId}:${pageId}`
  }

  getRendererContextForGuest(guestWebContentsId: number): {
    browserPageId: string
    renderer: Electron.WebContents
    rootGuestWebContentsId?: number
  } | null {
    const owner = this.resolvePopupOwnerContext(guestWebContentsId)
    if (!owner) {
      return null
    }
    const browserPageId = owner.browserTabId
    const ownerGuestId = owner.rootGuestWebContentsId
    const rendererId = this.nativeRendererByGuestId.get(ownerGuestId)
    const renderer =
      rendererId === undefined
        ? this.resolveRendererForBrowserTab(browserPageId)
        : webContents.fromId(rendererId)
    return renderer && !renderer.isDestroyed()
      ? {
          browserPageId,
          renderer,
          ...(rendererId === undefined ? {} : { rootGuestWebContentsId: ownerGuestId })
        }
      : null
  }
}
