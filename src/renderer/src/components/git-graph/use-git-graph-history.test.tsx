// @vitest-environment happy-dom

import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GitGraphResult, GitGraphScope } from '../../../../shared/git-graph-types'
import { GIT_GRAPH_UNSUPPORTED_CODE } from '../../../../shared/git-graph-errors'
import type { RuntimeGitContext } from '@/runtime/runtime-git-client-context'

const mocks = vi.hoisted(() => ({ getRuntimeGitGraph: vi.fn() }))

vi.mock('@/runtime/runtime-git-status-client', () => ({
  getRuntimeGitGraph: mocks.getRuntimeGitGraph
}))

import { useGitGraphHistory } from './use-git-graph-history'
import {
  deferred,
  flush,
  mountProbe,
  unmountProbes
} from '../right-sidebar/source-control-hook-test-harness'

const CONTEXT: RuntimeGitContext = {
  target: { kind: 'local' },
  worktreeId: 'wt',
  worktreePath: '/repo'
}
const resolveContext = (): RuntimeGitContext => CONTEXT

function graphPage(ids: string[], overrides: Partial<GitGraphResult> = {}): GitGraphResult {
  return {
    items: ids.map((id) => ({ id, parentIds: [], subject: id, message: id })),
    refs: [],
    scope: 'all',
    hasMore: false,
    truncated: false,
    isShallow: false,
    ...overrides
  }
}

let latest: ReturnType<typeof useGitGraphHistory> | null = null

function Probe({
  ownerKey = 'owner',
  scope = 'all',
  refs
}: {
  ownerKey?: string
  scope?: GitGraphScope
  refs?: string[]
}): null {
  latest = useGitGraphHistory({ ownerKey, resolveContext, scope, refs })
  return null
}

function loadedIds(): string[] | undefined {
  return latest?.state.result?.items.map((item) => item.id)
}

afterEach(() => {
  unmountProbes()
  vi.clearAllMocks()
  latest = null
})

describe('useGitGraphHistory', () => {
  it('never publishes a response for a scope the user already left', async () => {
    const allScope = deferred<GitGraphResult>()
    const localScope = deferred<GitGraphResult>()
    mocks.getRuntimeGitGraph
      .mockReturnValueOnce(allScope.promise)
      .mockReturnValueOnce(localScope.promise)
    const root = await mountProbe(<Probe scope="all" />)
    await act(async () => {
      root.render(<Probe scope="local" />)
    })

    localScope.resolve(graphPage(['local-tip'], { scope: 'local' }))
    await flush()
    allScope.resolve(graphPage(['all-tip']))
    await flush()

    expect(loadedIds()).toEqual(['local-tip'])
    expect(mocks.getRuntimeGitGraph.mock.calls[0]?.[2]?.signal?.aborted).toBe(true)
  })

  it('pages with the real cursor and replays the loaded depth on refresh', async () => {
    mocks.getRuntimeGitGraph
      .mockResolvedValueOnce(graphPage(['a', 'b'], { hasMore: true, nextCursor: 'c1' }))
      .mockResolvedValueOnce(graphPage(['b', 'c'], { hasMore: true, nextCursor: 'c2' }))
    await mountProbe(<Probe />)
    await flush()
    act(() => latest?.loadMore())
    await flush()

    expect(loadedIds()).toEqual(['a', 'b', 'c'])
    expect(mocks.getRuntimeGitGraph.mock.calls[1]?.[1]).toMatchObject({ cursor: 'c1' })

    mocks.getRuntimeGitGraph
      .mockResolvedValueOnce(graphPage(['new', 'a'], { hasMore: true, nextCursor: 'r1' }))
      .mockResolvedValueOnce(graphPage(['b', 'c'], { hasMore: true, nextCursor: 'r2' }))
    act(() => latest?.refresh())
    await flush()
    await flush()

    expect(loadedIds()).toEqual(['new', 'a', 'b', 'c'])
    expect(mocks.getRuntimeGitGraph.mock.calls[2]?.[1]).not.toHaveProperty('cursor')
    expect(mocks.getRuntimeGitGraph.mock.calls[3]?.[1]).toMatchObject({ cursor: 'r1' })
  })

  it('reports an old host as unsupported instead of falling back to HEAD history', async () => {
    mocks.getRuntimeGitGraph.mockRejectedValueOnce(new Error(GIT_GRAPH_UNSUPPORTED_CODE))
    await mountProbe(<Probe />)
    await flush()

    expect(latest?.state.status).toBe('unsupported')
    expect(latest?.state.result).toBeUndefined()
    expect(mocks.getRuntimeGitGraph).toHaveBeenCalledTimes(1)
  })

  it('never publishes a response for a refs selection the user already left', async () => {
    const firstSelection = deferred<GitGraphResult>()
    const secondSelection = deferred<GitGraphResult>()
    mocks.getRuntimeGitGraph
      .mockReturnValueOnce(firstSelection.promise)
      .mockReturnValueOnce(secondSelection.promise)
    const root = await mountProbe(<Probe scope="refs" refs={['refs/heads/main']} />)
    await act(async () => {
      root.render(<Probe scope="refs" refs={['refs/heads/dev']} />)
    })

    secondSelection.resolve(graphPage(['dev-tip'], { scope: 'refs' }))
    await flush()
    firstSelection.resolve(graphPage(['main-tip'], { scope: 'refs' }))
    await flush()

    expect(loadedIds()).toEqual(['dev-tip'])
    expect(mocks.getRuntimeGitGraph.mock.calls[0]?.[1]).toMatchObject({
      scope: 'refs',
      refs: ['refs/heads/main']
    })
    expect(mocks.getRuntimeGitGraph.mock.calls[1]?.[1]).toMatchObject({
      scope: 'refs',
      refs: ['refs/heads/dev']
    })
  })

  it('does not request when scope is refs but no refs are selected', async () => {
    await mountProbe(<Probe scope="refs" />)
    await flush()

    expect(latest?.state.status).toBe('idle')
    expect(mocks.getRuntimeGitGraph).not.toHaveBeenCalled()
  })
})
