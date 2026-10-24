import type { WebContents } from 'electron'
import { keybindingMatchesAction, type KeybindingOverrides } from '../../shared/keybindings'
import { installWindowLocalZoomShortcuts } from './window-zoom-shortcuts'

/**
 * Main-process chords for an extra window. The web client handles every other key itself, but
 * it cannot zoom its own webContents or ask the desktop for another window.
 */
export function installRuntimeClientWindowShortcuts(
  contents: WebContents,
  options: {
    getKeybindings: () => KeybindingOverrides | undefined
    onNewWindow: () => void
  }
): void {
  installWindowLocalZoomShortcuts(contents, options.getKeybindings)
  contents.on('before-input-event', (event, input) => {
    if (
      input.type === 'keyDown' &&
      keybindingMatchesAction('window.new', input, process.platform, options.getKeybindings(), {
        context: 'app'
      })
    ) {
      event.preventDefault()
      if (!input.isAutoRepeat) {
        options.onNewWindow()
      }
    }
  })
}
