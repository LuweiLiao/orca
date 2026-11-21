import type { WebContents } from 'electron'
import {
  hasDesktopRenderers,
  isRegisteredDesktopRenderer
} from '../../window/native-windows/desktop-renderer-registry'

export function isTrustedMainRendererSender(
  sender: WebContents,
  pinnedWebContentsId: number | null
): boolean {
  if (sender.isDestroyed() || sender.getType() !== 'window') {
    return false
  }
  // With native desktop windows open, each registered window is a main renderer.
  if (hasDesktopRenderers()) {
    return isRegisteredDesktopRenderer(sender)
  }
  if (pinnedWebContentsId != null) {
    return sender.id === pinnedWebContentsId
  }

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (!rendererUrl) {
    // Packaged builds trust only the registered main-window ID, never arbitrary file:// documents.
    return false
  }
  try {
    return new URL(sender.getURL()).origin === new URL(rendererUrl).origin
  } catch {
    return false
  }
}
