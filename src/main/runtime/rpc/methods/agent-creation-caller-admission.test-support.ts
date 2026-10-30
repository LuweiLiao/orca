import { vi } from 'vitest'
import type * as Admission from './agent-creation-caller-admission'

/**
 * For suites about how a launch runs once admitted: every caller is treated as a person's app.
 * Who may create agents is tested against the real admission in agent-creation tests.
 */
export async function admitEveryAgentCreationCaller(): Promise<typeof Admission> {
  const { assertAgentLaunchTargetAuthorized } = await import('./agent-launch-target-authorization')
  return {
    assertPersonCreatesAgent: vi.fn(),
    assertAgentLaunchAdmitted: assertAgentLaunchTargetAuthorized
  }
}
