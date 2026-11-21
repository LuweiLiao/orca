import type { BrowserWindow } from 'electron'
import { broadcastDesktopRendererEvent } from '../../window/native-windows/desktop-renderer-registry'

export function emitCloneProgressFromText(mainWindow: BrowserWindow, text: string): void {
  for (const line of text.split(/[\r\n]+/)) {
    const match = line.match(/^([\w\s]+):\s+(\d+)%/)
    if (!match) {
      continue
    }
    const progress = { phase: match[1].trim(), percent: Number.parseInt(match[2], 10) }
    // Every native desktop window shows clone progress; the starting window is the fallback.
    if (
      broadcastDesktopRendererEvent('repos:clone-progress', progress) === 0 &&
      !mainWindow.isDestroyed()
    ) {
      mainWindow.webContents.send('repos:clone-progress', progress)
    }
  }
}
