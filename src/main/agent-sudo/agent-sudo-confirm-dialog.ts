import { BrowserWindow, dialog, type MessageBoxOptions } from 'electron'
import { translateMain } from '../i18n/main-i18n'
import type { AgentSudoAskpassRequest } from './agent-sudo-askpass-server'
import { describeSudoCommand } from './agent-sudo-decision'

// Shorter than the helper's curl --max-time, so sudo sees a denial rather than a transport error.
const CONFIRM_TIMEOUT_MS = 120_000

function pickParentWindow(): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow()
  if (focused && !focused.isDestroyed()) {
    return focused
  }
  return BrowserWindow.getAllWindows().find((win) => !win.isDestroyed() && win.isVisible()) ?? null
}

export async function confirmAgentSudoRequest(
  request: AgentSudoAskpassRequest,
  signal: AbortSignal
): Promise<boolean> {
  const timeout = AbortSignal.timeout(CONFIRM_TIMEOUT_MS)
  const command = describeSudoCommand(request.command) || 'sudo'
  const detail = [
    translateMain('agentSudo.confirm.command', 'Command: {{command}}', { command }),
    request.cwd
      ? translateMain('agentSudo.confirm.cwd', 'Directory: {{cwd}}', { cwd: request.cwd })
      : null,
    translateMain(
      'agentSudo.confirm.risk',
      'Allowing gives this command root access. Deny unless you expected it.'
    )
  ]
    .filter((line): line is string => line !== null)
    .join('\n\n')
  const options: MessageBoxOptions = {
    type: 'warning',
    title: translateMain('agentSudo.confirm.title', 'Allow sudo?'),
    message: translateMain(
      'agentSudo.confirm.message',
      'A terminal in Orca is asking for your sudo password.'
    ),
    detail,
    buttons: [
      translateMain('agentSudo.confirm.deny', 'Deny'),
      translateMain('agentSudo.confirm.allow', 'Allow')
    ],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    signal: AbortSignal.any([signal, timeout])
  }
  const parent = pickParentWindow()
  const result = parent
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options)
  return result.response === 1 && !signal.aborted && !timeout.aborted
}
