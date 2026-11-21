import type { BrowserWindow } from 'electron'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import type { RuntimeNotifier } from '../../runtime/client/events/runtime-notifier-contract'
import { nativeDesktopWindowGraphs } from '../../runtime/session-graph/native-desktop-window-graphs'
import { desktopWindowId } from './desktop-renderer-registry'
import { registerNativeDesktopNotifier } from './native-desktop-notifiers'
import type { RuntimeRendererGraphFailureReason } from '../renderer-relays/runtime-renderer-notification-sender'

/**
 * How one window joins the runtime graph. A legacy window owns the graph and the notifier; native
 * desktop windows publish into one merged graph and share a notifier multiplexed per renderer.
 */
export function bindRuntimeWindow(window: BrowserWindow, runtime: OrcaRuntimeService) {
  const windowId = window.id
  const native = Boolean(desktopWindowId(window.webContents))
  let available = true
  let unregisterNotifier: (() => void) | null = null
  if (!native) {
    runtime.attachWindow(windowId)
  }
  return {
    native,
    windowId,
    setAvailable: (next: boolean): void => {
      available = next
    },
    renderFailed: (reason: RuntimeRendererGraphFailureReason): void => {
      if (native) {
        available = false
        nativeDesktopWindowGraphs(runtime).remove(windowId)
      } else {
        runtime.markGraphReloadFailed(windowId, reason)
      }
    },
    /** `sendReset` reports whether the renderer accepted the reset that recovers its listeners. */
    installNotifier: (notifier: RuntimeNotifier, sendReset: () => boolean): void => {
      if (native) {
        unregisterNotifier = registerNativeDesktopNotifier(
          runtime,
          window,
          notifier,
          () => available,
          sendReset
        )
      } else {
        runtime.setNotifier(notifier)
      }
    },
    close: (): void => {
      if (native) {
        unregisterNotifier?.()
        nativeDesktopWindowGraphs(runtime).remove(windowId)
      } else {
        runtime.markGraphUnavailable(windowId)
      }
    }
  }
}
