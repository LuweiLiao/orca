import type { WebContents } from 'electron'
import { browserManager } from '../../browser/guest-lifecycle/manager/browser-manager'
import type { AgentBrowserBridge } from '../../browser/agent-browser/agent-browser-bridge'
import { cancelBrowserWebAuthnAccountRequests } from '../../browser/webauthn/browser-webauthn-account-picker'
import { desktopWindowId } from '../../window/native-windows/desktop-renderer-registry'

export type BrowserAgentLifecycle = Pick<
  AgentBrowserBridge,
  'onProcessSwap' | 'onTabClosed' | 'onTabChanged' | 'onPageClosed'
>

/** The sender's own guest of a page: a native window never addresses a peer window's guest. */
export function senderGuestWebContentsId(
  sender: WebContents,
  browserPageId: string
): number | null {
  return desktopWindowId(sender)
    ? browserManager.getGuestWebContentsIdForRenderer(browserPageId, sender.id)
    : browserManager.getGuestWebContentsId(browserPageId)
}

/** Unregisters the sender's guest of a page; false when it holds none or a replacement raced it. */
export function unregisterSenderBrowserGuest(
  sender: WebContents,
  args: { browserPageId: string; webContentsId?: number; replacement?: boolean },
  bridge: BrowserAgentLifecycle | null
): boolean {
  const isNative = Boolean(desktopWindowId(sender))
  const wcId = senderGuestWebContentsId(sender, args.browserPageId)
  if (isNative && wcId === null) {
    return false
  }
  if (args.replacement && args.webContentsId !== undefined && wcId !== args.webContentsId) {
    return false
  }
  // Destroy bridge sessions before unregistering clears the guest mapping.
  if (wcId !== null && bridge) {
    if (args.replacement) {
      void bridge.onProcessSwap(args.browserPageId, wcId).catch(() => {})
    } else {
      bridge.onTabClosed(wcId)
    }
  } else if (!args.replacement && bridge) {
    void bridge.onPageClosed(args.browserPageId).catch(() => {})
  }
  if (wcId !== null || !isNative) {
    cancelBrowserWebAuthnAccountRequests(
      args.browserPageId,
      isNative ? (wcId ?? undefined) : undefined
    )
  }
  const reason = args.replacement ? 'guest-destroyed' : 'page-closed'
  if (browserManager.unregisterGuestForRenderer(args.browserPageId, sender.id, reason)) {
    return true
  }
  if (isNative) {
    return false
  }
  browserManager.unregisterGuest(args.browserPageId, reason)
  return true
}
