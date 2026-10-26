import type { AgentSudoMode } from '../../shared/agent-sudo-types'
import type { AgentSudoAskpassRequest } from './agent-sudo-askpass-server'

export type AgentSudoConfirm = (
  request: AgentSudoAskpassRequest,
  signal: AbortSignal
) => Promise<boolean>

type AgentSudoDecisionDeps = {
  hasPassword: () => boolean
  readPassword: () => string | null
  readMode: () => AgentSudoMode
  confirm: AgentSudoConfirm
  /** sudo asked again after Orca answered, so the saved password is wrong. */
  onRejected: () => void
  now?: () => number
}

// sudo re-asks within seconds of a wrong answer; a pid reused later is a different sudo.
const SUPPLIED_PID_TTL_MS = 5 * 60_000

/** Display form of the sudo argv, without the shim's -A and the absolute path. */
export function describeSudoCommand(command: string): string {
  const words = command.trim().split(/\s+/)
  if (words.length > 0 && /(^|\/)sudo$/.test(words[0] ?? '')) {
    words[0] = 'sudo'
    if (words[1] === '-A') {
      words.splice(1, 1)
    }
  }
  const text = words.join(' ')
  return text.length > 400 ? `${text.slice(0, 400)}…` : text
}

export function createAgentSudoDecision(deps: AgentSudoDecisionDeps) {
  const now = deps.now ?? Date.now
  const suppliedAt = new Map<number, number>()
  let rejected = false
  let confirmQueue: Promise<unknown> = Promise.resolve()

  function pruneSupplied(): void {
    const cutoff = now() - SUPPLIED_PID_TTL_MS
    for (const [pid, at] of suppliedAt) {
      if (at < cutoff) {
        suppliedAt.delete(pid)
      }
    }
  }

  // One dialog at a time; parallel sudo calls would otherwise stack modal prompts.
  function serializedConfirm(request: AgentSudoAskpassRequest, signal: AbortSignal) {
    const next = confirmQueue.then(() => (signal.aborted ? false : deps.confirm(request, signal)))
    confirmQueue = next.catch(() => undefined)
    return next
  }

  return {
    isRejected: () => rejected,
    reset: () => {
      rejected = false
      suppliedAt.clear()
    },
    handle: async (
      request: AgentSudoAskpassRequest,
      signal: AbortSignal
    ): Promise<string | null> => {
      // Without sudo's pid a wrong password could not be detected, risking account lockout.
      if (rejected || request.sudoPid === null || !deps.hasPassword()) {
        return null
      }
      pruneSupplied()
      if (suppliedAt.has(request.sudoPid)) {
        suppliedAt.delete(request.sudoPid)
        rejected = true
        deps.onRejected()
        return null
      }
      if (deps.readMode() === 'confirm') {
        const allowed = await serializedConfirm(request, signal)
        if (!allowed || signal.aborted || rejected) {
          return null
        }
      }
      const password = deps.readPassword()
      if (password === null) {
        return null
      }
      suppliedAt.set(request.sudoPid, now())
      return password
    }
  }
}

export type AgentSudoDecision = ReturnType<typeof createAgentSudoDecision>
