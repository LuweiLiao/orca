import { vi } from 'vitest'
import { registerWorkerReleaseArchiveTests } from './worker-release-archive.spec'
import { registerWorkerReleaseInventoryTests } from './worker-release-inventory.spec'

vi.mock('../../../../orchestration/db/delegation-grants/agent-delegation-grant-store', async () =>
  (
    await import('../../../../orchestration/db/delegation-grants/agent-delegation-grant-store.test-support')
  ).admitEveryAgentDelegation()
)

registerWorkerReleaseArchiveTests()
registerWorkerReleaseInventoryTests()
