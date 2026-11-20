import { vi } from 'vitest'
import type * as GrantStore from './agent-delegation-grant-store'

/**
 * For suites about what happens after a worker-start is admitted: every start is treated as one the
 * user authorized. Authorization itself is tested against the real store in agent-delegation tests.
 */
export async function admitEveryAgentDelegation(): Promise<typeof GrantStore> {
  const actual = await vi.importActual<typeof GrantStore>('./agent-delegation-grant-store')
  return {
    ...actual,
    claimAgentDelegationSlotInTransaction: vi.fn(),
    claimAgentDelegationReuseInTransaction: vi.fn()
  }
}
