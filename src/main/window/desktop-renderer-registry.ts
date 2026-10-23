import { BrowserWindow, type WebContents } from 'electron'

const renderers = new Map<number, WebContents>()
const rendererIds = new WeakMap<WebContents, number>()

export function registerDesktopRenderer(renderer: WebContents): void {
  if (rendererIds.has(renderer)) {
    return
  }
  rendererIds.set(renderer, renderer.id)
  renderers.set(renderer.id, renderer)
  renderer.on('destroyed', () => unregisterDesktopRenderer(renderer))
}

export function unregisterDesktopRenderer(renderer: WebContents): void {
  const id = rendererIds.get(renderer)
  if (id !== undefined && renderers.get(id) === renderer) {
    renderers.delete(id)
  }
  rendererIds.delete(renderer)
}

export function isRegisteredDesktopRenderer(renderer: WebContents): boolean {
  return (
    !renderer.isDestroyed() &&
    renderers.get(renderer.id) === renderer &&
    renderer.getType() === 'window'
  )
}

export function listDesktopRenderers(excludedId?: number): WebContents[] {
  return [...renderers.values()].filter(
    (renderer) => isRegisteredDesktopRenderer(renderer) && renderer.id !== excludedId
  )
}

export function preferredDesktopRenderer(excludedId?: number): WebContents | null {
  if (renderers.size === 0) {
    return null
  }
  const focused = BrowserWindow.getFocusedWindow()?.webContents
  if (focused && focused.id !== excludedId && isRegisteredDesktopRenderer(focused)) {
    return focused
  }
  return listDesktopRenderers(excludedId)[0] ?? null
}

export function isTrustedDesktopRenderer(
  renderer: WebContents,
  primaryRendererId: number | null,
  allowFileUrlFallback: boolean
): boolean {
  if (renderer.isDestroyed() || renderer.getType() !== 'window') {
    return false
  }
  if (renderers.size > 0) {
    return isRegisteredDesktopRenderer(renderer)
  }
  if (primaryRendererId !== null) {
    return renderer.id === primaryRendererId
  }
  const url = renderer.getURL()
  if (process.env.ELECTRON_RENDERER_URL) {
    try {
      return new URL(url).origin === new URL(process.env.ELECTRON_RENDERER_URL).origin
    } catch {
      return false
    }
  }
  return allowFileUrlFallback && url.startsWith('file://')
}
