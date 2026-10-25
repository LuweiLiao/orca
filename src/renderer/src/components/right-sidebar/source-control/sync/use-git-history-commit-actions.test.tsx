// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeGitContext } from '@/runtime/runtime-git-client-context'
import type { GitCommitCompareResult } from '../../../../../../shared/git-diff-compare-types'
import type { GitHistoryItem } from '../../../../../../shared/git-history-types'
import { deferred, flush, mountProbe, unmountProbes } from '../../source-control-hook-test-harness'

const mocks = vi.hoisted(() => ({
  compare: vi.fn(),
  openCommitDiff: vi.fn(),
  openCommitAllDiffs: vi.fn(),
  error: vi.fn()
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: typeof mocks) => unknown) => selector(mocks)
}))
vi.mock('@/runtime/runtime-git-diff-client', () => ({
  getRuntimeGitCommitCompare: mocks.compare
}))
vi.mock('sonner', () => ({ toast: { error: mocks.error, success: vi.fn() } }))

import { useGitHistoryCommitActions } from './use-git-history-commit-actions'

const context: RuntimeGitContext = {
  target: { kind: 'local' },
  worktreeId: 'workspace',
  worktreePath: '/repo'
}
const entry = { path: 'proof.txt', status: 'added' as const }

function commit(id: string): GitHistoryItem {
  return { id, subject: id, message: id, parentIds: [] }
}

function comparison(id: string): GitCommitCompareResult {
  return {
    summary: {
      commitOid: id,
      parentOid: null,
      compareRef: id,
      baseRef: 'empty',
      changedFiles: 1,
      status: 'ready'
    },
    entries: [entry]
  }
}

let actions: ReturnType<typeof useGitHistoryCommitActions> | undefined

function Probe({ resolveContext }: { resolveContext: () => RuntimeGitContext }): null {
  actions = useGitHistoryCommitActions({
    activeWorktreeId: 'workspace',
    worktreePath: '/repo',
    activeRepoTarget: context.target,
    resolveSplitTargetGroupId: () => undefined,
    resolveContext
  })
  return null
}

beforeEach(() => {
  mocks.compare.mockImplementation(async (_context: RuntimeGitContext, id: string) =>
    comparison(id)
  )
})

afterEach(() => {
  unmountProbes()
  vi.resetAllMocks()
  actions = undefined
})

describe('commit actions for a captured graph owner', () => {
  it('rejects a compare response after the workspace owner changes', async () => {
    const pending = deferred<GitCommitCompareResult>()
    mocks.compare.mockReturnValueOnce(pending.promise)
    let valid = true
    await mountProbe(
      <Probe
        resolveContext={() => {
          if (!valid) {
            throw new Error('Owner changed')
          }
          return context
        }}
      />
    )
    const opened = actions?.openHistoryCommitDiff(commit('old'))
    valid = false
    pending.resolve(comparison('old'))
    await opened
    expect(mocks.openCommitAllDiffs).not.toHaveBeenCalled()
    expect(mocks.error).toHaveBeenCalledWith('Owner changed')
  })

  it('reloads an evicted compare before opening a previously visited file', async () => {
    await mountProbe(<Probe resolveContext={() => context} />)
    for (let index = 0; index < 41; index++) {
      await actions?.loadCommitFiles(commit(String(index)))
    }
    actions?.openCommitFile(commit('0'), entry)
    await flush()
    expect(mocks.compare).toHaveBeenCalledTimes(42)
    expect(mocks.openCommitDiff).toHaveBeenCalledWith(
      'workspace',
      '/repo',
      entry,
      expect.objectContaining({ commitOid: '0' }),
      expect.any(String),
      expect.objectContaining({ preview: true })
    )
  })

  it('checks ownership even when the requested commit is cached', async () => {
    let valid = true
    await mountProbe(
      <Probe
        resolveContext={() => {
          if (!valid) {
            throw new Error('Owner changed')
          }
          return context
        }}
      />
    )
    await actions?.loadCommitFiles(commit('cached'))
    valid = false
    actions?.openCommitFile(commit('cached'), entry)
    expect(mocks.openCommitDiff).not.toHaveBeenCalled()
    expect(mocks.error).toHaveBeenCalledWith('Owner changed')
  })
})
