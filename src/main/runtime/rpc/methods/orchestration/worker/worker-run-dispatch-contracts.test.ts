import { vi } from 'vitest'
import { registerWorkerListRunScopeRpcTests } from './worker-list-run-scope-rpc.spec'
import { registerWorkerStartTerminalTargetTests } from './worker-start-terminal-target.spec'

vi.mock('../../../../orchestration/db/delegation-grants/agent-delegation-grant-store', async () =>
  (
    await import('../../../../orchestration/db/delegation-grants/agent-delegation-grant-store.test-support')
  ).admitEveryAgentDelegation()
)

registerWorkerListRunScopeRpcTests()
registerWorkerStartTerminalTargetTests()
