import { beforeEach, expect, it, vi } from 'vitest'
import { GIT_GRAPH_UNSUPPORTED_CODE, getGitGraphErrorCode } from '../../../shared/git-graph-errors'
import {
  createCompatibleRuntimeStatusResponseIfNeeded,
  type RuntimeEnvironmentCallRequest
} from './runtime-compatibility-test-fixture'
import { clearRuntimeCompatibilityCacheForTests } from './runtime-rpc-client'
import { getRuntimeGitGraph } from './runtime-git-status-client'

const gitHistory = vi.fn()
const gitHistoryGraph = vi.fn()
const runtimeEnvironmentCall = vi.fn()

beforeEach(() => {
  clearRuntimeCompatibilityCacheForTests()
  gitHistory.mockReset()
  gitHistoryGraph.mockReset()
  runtimeEnvironmentCall.mockReset()
  vi.stubGlobal('window', {
    api: {
      git: { history: gitHistory, historyGraph: gitHistoryGraph },
      runtimeEnvironments: {
        call: (args: RuntimeEnvironmentCallRequest) =>
          createCompatibleRuntimeStatusResponseIfNeeded(args) ?? runtimeEnvironmentCall(args)
      }
    }
  })
})

it('reports an older runtime as unsupported instead of falling back to HEAD history', async () => {
  runtimeEnvironmentCall.mockResolvedValue({
    id: 'rpc-1',
    ok: false,
    error: { code: 'method_not_found', message: 'Unknown method: git.historyGraph' },
    _meta: { runtimeId: 'remote-runtime' }
  })

  const error = await getRuntimeGitGraph(
    {
      target: { kind: 'environment' as const, environmentId: 'env-1' },
      worktreeId: 'wt-1',
      worktreePath: '/repo'
    },
    { scope: 'all', limit: 100 }
  ).catch((caught: unknown) => caught)

  expect(getGitGraphErrorCode(error)).toBe(GIT_GRAPH_UNSUPPORTED_CODE)
  expect(runtimeEnvironmentCall).toHaveBeenCalledTimes(1)
  expect(runtimeEnvironmentCall).toHaveBeenCalledWith(
    expect.objectContaining({
      method: 'git.historyGraph',
      params: { worktree: 'id:wt-1', scope: 'all', limit: 100 }
    })
  )
  expect(gitHistory).not.toHaveBeenCalled()
})

it('classifies a web host predating the method the same way', async () => {
  gitHistoryGraph.mockRejectedValue(
    Object.assign(new Error('Unknown method: git.historyGraph'), { code: 'method_not_found' })
  )

  const error = await getRuntimeGitGraph(
    { target: { kind: 'local' as const }, worktreeId: 'wt-1', worktreePath: '/repo' },
    { scope: 'head' }
  ).catch((caught: unknown) => caught)

  expect(getGitGraphErrorCode(error)).toBe(GIT_GRAPH_UNSUPPORTED_CODE)
  expect(gitHistory).not.toHaveBeenCalled()
})
