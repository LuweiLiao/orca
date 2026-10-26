import { describe, expect, it, vi } from 'vitest'
import type { AgentSudoMode } from '../../shared/agent-sudo-types'
import { createAgentSudoDecision, describeSudoCommand } from './agent-sudo-decision'

function setup(mode: AgentSudoMode, confirmAnswer = true) {
  const confirm = vi.fn(async () => confirmAnswer)
  const onRejected = vi.fn()
  const decision = createAgentSudoDecision({
    hasPassword: () => true,
    readPassword: () => 'secret',
    readMode: () => mode,
    confirm,
    onRejected
  })
  const ask = (sudoPid: number | null) =>
    decision.handle(
      { sudoPid, command: '/usr/bin/sudo -A apt update', cwd: '/', prompt: '' },
      new AbortController().signal
    )
  return { decision, confirm, onRejected, ask }
}

describe('agent sudo decision', () => {
  it('asks before supplying in confirm mode, and supplies nothing on denial', async () => {
    const allowed = setup('confirm', true)
    await expect(allowed.ask(10)).resolves.toBe('secret')
    expect(allowed.confirm).toHaveBeenCalledTimes(1)

    const denied = setup('confirm', false)
    await expect(denied.ask(10)).resolves.toBeNull()
  })

  it('stops supplying after sudo re-asks the same process, until reset', async () => {
    const { decision, confirm, onRejected, ask } = setup('auto')
    await expect(ask(42)).resolves.toBe('secret')
    await expect(ask(42)).resolves.toBeNull()
    expect(onRejected).toHaveBeenCalledTimes(1)
    await expect(ask(43)).resolves.toBeNull()
    expect(confirm).not.toHaveBeenCalled()

    decision.reset()
    await expect(ask(43)).resolves.toBe('secret')
  })

  it('refuses a request whose sudo process cannot be identified', async () => {
    await expect(setup('auto').ask(null)).resolves.toBeNull()
  })

  it('shows the command as the user typed it', () => {
    expect(describeSudoCommand('/run/wrappers/bin/sudo -A apt install x')).toBe(
      'sudo apt install x'
    )
  })
})
