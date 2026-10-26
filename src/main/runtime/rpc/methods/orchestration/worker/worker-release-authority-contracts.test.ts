import { vi } from 'vitest'
import { registerWorkerReleaseOwnershipGuardTests } from './worker-release-ownership-guard.spec'
import { registerWorkerReleaseRuntimeIncarnationTests } from './worker-release-runtime-incarnation.spec'

vi.mock('../../../../orchestration/db/delegation-grants/agent-delegation-grant-store', async () =>
  (
    await import('../../../../orchestration/db/delegation-grants/agent-delegation-grant-store.test-support')
  ).admitEveryAgentDelegation()
)

registerWorkerReleaseOwnershipGuardTests()
registerWorkerReleaseRuntimeIncarnationTests()
