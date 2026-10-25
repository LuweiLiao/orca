import { describe, expect, it } from 'vitest'
import type { GitHistoryItemRef } from '../../../../shared/git-history-types'
import {
  ALL_BRANCHES_FILTER,
  CURRENT_BRANCH_FILTER,
  gitGraphFilterToOptions,
  pruneGitGraphFilterRefs,
  pruneGitGraphFilterRemoteRefs,
  toggleGitGraphFilterRef,
  type GitGraphBranchFilter
} from './git-graph-branch-filter'

function ref(id: string, category: GitHistoryItemRef['category']): GitHistoryItemRef {
  return { id, name: id, category }
}

describe('toggleGitGraphFilterRef', () => {
  it('switches from All branches to a single selected ref', () => {
    const next = toggleGitGraphFilterRef(ALL_BRANCHES_FILTER, 'refs/heads/main')
    expect(next).toEqual({ mode: 'selected', refIds: ['refs/heads/main'] })
  })

  it('switches from Current branch to a single selected ref', () => {
    const next = toggleGitGraphFilterRef(CURRENT_BRANCH_FILTER, 'refs/heads/main')
    expect(next).toEqual({ mode: 'selected', refIds: ['refs/heads/main'] })
  })

  it('adds a second ref while already selected', () => {
    const filter: GitGraphBranchFilter = { mode: 'selected', refIds: ['refs/heads/main'] }
    const next = toggleGitGraphFilterRef(filter, 'refs/heads/dev')
    expect(next).toEqual({ mode: 'selected', refIds: ['refs/heads/main', 'refs/heads/dev'] })
  })

  it('removes a selected ref, keeping the rest', () => {
    const filter: GitGraphBranchFilter = {
      mode: 'selected',
      refIds: ['refs/heads/main', 'refs/heads/dev']
    }
    const next = toggleGitGraphFilterRef(filter, 'refs/heads/dev')
    expect(next).toEqual({ mode: 'selected', refIds: ['refs/heads/main'] })
  })

  it('falls back to All branches when the last selected ref is removed', () => {
    const filter: GitGraphBranchFilter = { mode: 'selected', refIds: ['refs/heads/main'] }
    const next = toggleGitGraphFilterRef(filter, 'refs/heads/main')
    expect(next).toEqual(ALL_BRANCHES_FILTER)
  })
})

describe('pruneGitGraphFilterRefs', () => {
  it('drops refs that no longer resolve, keeping the rest selected', () => {
    const filter: GitGraphBranchFilter = {
      mode: 'selected',
      refIds: ['refs/heads/main', 'refs/heads/gone']
    }
    const next = pruneGitGraphFilterRefs(filter, new Set(['refs/heads/gone']))
    expect(next).toEqual({ mode: 'selected', refIds: ['refs/heads/main'] })
  })

  it('falls back to All branches when every selected ref goes missing', () => {
    const filter: GitGraphBranchFilter = { mode: 'selected', refIds: ['refs/heads/gone'] }
    const next = pruneGitGraphFilterRefs(filter, new Set(['refs/heads/gone']))
    expect(next).toEqual(ALL_BRANCHES_FILTER)
  })

  it('is a no-op outside selected mode', () => {
    expect(pruneGitGraphFilterRefs(ALL_BRANCHES_FILTER, new Set(['refs/heads/gone']))).toBe(
      ALL_BRANCHES_FILTER
    )
    expect(pruneGitGraphFilterRefs(CURRENT_BRANCH_FILTER, new Set(['x']))).toBe(
      CURRENT_BRANCH_FILTER
    )
  })

  it('is a no-op when nothing is missing', () => {
    const filter: GitGraphBranchFilter = { mode: 'selected', refIds: ['refs/heads/main'] }
    expect(pruneGitGraphFilterRefs(filter, new Set())).toBe(filter)
  })

  it('returns the same reference when the missing set does not intersect the selection', () => {
    const filter: GitGraphBranchFilter = { mode: 'selected', refIds: ['refs/heads/main'] }
    expect(pruneGitGraphFilterRefs(filter, new Set(['refs/heads/unrelated']))).toBe(filter)
  })
})

describe('pruneGitGraphFilterRemoteRefs', () => {
  const refsById = new Map<string, GitHistoryItemRef>([
    ['refs/heads/main', ref('refs/heads/main', 'branches')],
    ['refs/remotes/origin/main', ref('refs/remotes/origin/main', 'remote branches')]
  ])

  it('drops only the remote-branch refs from the selection', () => {
    const filter: GitGraphBranchFilter = {
      mode: 'selected',
      refIds: ['refs/heads/main', 'refs/remotes/origin/main']
    }
    const next = pruneGitGraphFilterRemoteRefs(filter, refsById)
    expect(next).toEqual({ mode: 'selected', refIds: ['refs/heads/main'] })
  })

  it('falls back to All branches when only remote refs were selected', () => {
    const filter: GitGraphBranchFilter = { mode: 'selected', refIds: ['refs/remotes/origin/main'] }
    expect(pruneGitGraphFilterRemoteRefs(filter, refsById)).toEqual(ALL_BRANCHES_FILTER)
  })

  it('is a no-op outside selected mode', () => {
    expect(pruneGitGraphFilterRemoteRefs(ALL_BRANCHES_FILTER, refsById)).toBe(ALL_BRANCHES_FILTER)
  })

  it('ignores refs the picker has not seen yet', () => {
    const filter: GitGraphBranchFilter = { mode: 'selected', refIds: ['refs/heads/unknown'] }
    expect(pruneGitGraphFilterRemoteRefs(filter, refsById)).toBe(filter)
  })
})

describe('gitGraphFilterToOptions', () => {
  it('maps Current branch to scope head', () => {
    expect(gitGraphFilterToOptions(CURRENT_BRANCH_FILTER, true)).toEqual({ scope: 'head' })
  })

  it('maps All branches to scope all when remote branches are shown', () => {
    expect(gitGraphFilterToOptions(ALL_BRANCHES_FILTER, true)).toEqual({ scope: 'all' })
  })

  it('maps All branches to scope local when remote branches are hidden', () => {
    expect(gitGraphFilterToOptions(ALL_BRANCHES_FILTER, false)).toEqual({ scope: 'local' })
  })

  it('maps a selected ref set to scope refs regardless of the remote toggle', () => {
    const filter: GitGraphBranchFilter = {
      mode: 'selected',
      refIds: ['refs/heads/main', 'refs/remotes/origin/main']
    }
    expect(gitGraphFilterToOptions(filter, false)).toEqual({
      scope: 'refs',
      refs: ['refs/heads/main', 'refs/remotes/origin/main']
    })
  })
})
