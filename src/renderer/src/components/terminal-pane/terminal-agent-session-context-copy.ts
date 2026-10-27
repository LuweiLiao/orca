import { toast } from 'sonner'
import type { ManagedPane } from '@/lib/pane-manager/pane-manager'
import { buildBoundedSessionTranscript } from '../../../../shared/agent-session-fork-context'
import { translate } from '@/i18n/i18n'

// Why: the standalone "Copy Context" action copies the bounded transcript on its
// own — for pasting into another tool — so it must not carry the fork prompt's
// "this is a fork… acknowledge and wait" framing the dialog button uses.
export async function copyAgentSessionContextFromPane(pane: ManagedPane): Promise<boolean> {
  const transcript = buildBoundedSessionTranscript(
    pane.serializeAddon.serialize({ scrollback: 800 })
  )
  if (!transcript) {
    toast.error(
      translate(
        'auto.components.terminal.pane.terminal.agent.session.fork.f62b40e2c7',
        'No terminal context to copy'
      )
    )
    pane.terminal.focus()
    return false
  }
  try {
    await window.api.ui.writeTerminalClipboardText(transcript)
    toast.message(
      translate(
        'auto.components.terminal.pane.terminal.agent.session.fork.373a3103e7',
        'Context copied'
      )
    )
    pane.terminal.focus()
    return true
  } catch (error) {
    toast.error(
      error instanceof Error
        ? error.message
        : translate(
            'auto.components.terminal.pane.terminal.agent.session.fork.3fc568a49d',
            'Failed to copy context.'
          )
    )
    pane.terminal.focus()
    return false
  }
}
