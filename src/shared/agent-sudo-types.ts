/** How Orca answers a terminal's sudo password request. */
export type AgentSudoMode = 'confirm' | 'auto'

export const DEFAULT_AGENT_SUDO_MODE: AgentSudoMode = 'confirm'

export function isAgentSudoMode(value: unknown): value is AgentSudoMode {
  return value === 'confirm' || value === 'auto'
}

export type AgentSudoStatus = {
  /** False on hosts without POSIX sudo (Windows). */
  supported: boolean
  configured: boolean
  mode: AgentSudoMode
  /** sudo refused the saved password; Orca stops supplying it until it is saved again. */
  rejected: boolean
  /** Non-null when the OS keyring backend does not meaningfully protect the sealed password. */
  protectionGap: string | null
}

/** Newlines would end sudo's askpass line early and leak the remainder as a second attempt. */
export function isValidAgentSudoPassword(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= 1024 && !/[\r\n\0]/.test(value)
  )
}
