import { vi } from 'vitest'

/**
 * For suites about how a launch runs once admitted: every caller is treated as a person's app.
 * Who may create agents is tested against the real admission in agent-creation tests.
 */
export async function admitEveryAgentCreationCaller() {
  const { assertAgentLaunchTargetAuthorized } = await import('./agent-launch-target-authorization')
  return {
    assertPersonCreatesAgent: vi.fn(),
    assertAgentLaunchAdmitted: assertAgentLaunchTargetAuthorized
  }
}
