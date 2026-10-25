import { describe, expect, it } from 'vitest'
import type { GitGraphResult } from '../../../../shared/git-graph-types'
import type { GitHistoryItem } from '../../../../shared/git-history-types'
import { appendGitGraphPage, findGitGraphMatchIndexes, stepGitGraphMatch } from './git-graph-model'

function item(id: string, subject = id, refName?: string): GitHistoryItem {
  return {
    id,
    parentIds: [],
    subject,
    message: subject,
    displayId: id.slice(0, 4),
    references: refName ? [{ id: `refs/heads/${refName}`, name: refName }] : []
  }
}

function page(items: GitHistoryItem[], overrides: Partial<GitGraphResult> = {}): GitGraphResult {
  return {
    items,
    refs: [],
    scope: 'all',
    hasMore: false,
    truncated: false,
    isShallow: false,
    ...overrides
  }
}

describe('git graph paging', () => {
  it('appends only unseen commits and keeps the first page snapshot metadata', () => {
    const first = page([item('aaaa1'), item('bbbb2')], {
      headOid: 'aaaa1',
      refs: [{ id: 'refs/heads/main', name: 'main', revision: 'aaaa1' }],
      hasMore: true,
      nextCursor: 'c1'
    })
    const merged = appendGitGraphPage(
      first,
      page([item('bbbb2'), item('cccc3')], { headOid: 'moved', truncated: true })
    )

    expect(merged.items.map((entry) => entry.id)).toEqual(['aaaa1', 'bbbb2', 'cccc3'])
    expect(merged.headOid).toBe('aaaa1')
    expect(merged.refs).toBe(first.refs)
    expect(merged.hasMore).toBe(false)
    expect(merged.nextCursor).toBeUndefined()
    expect(merged.truncated).toBe(true)
  })
})

describe('git graph search', () => {
  const items = [
    item('aaaa1', 'Fix parser'),
    item('bbbb2', 'Docs', 'release'),
    item('cccc3', 'parser tests')
  ]

  it('matches subjects, ref names and SHA prefixes without dropping rows', () => {
    expect(findGitGraphMatchIndexes(items, 'PARSER')).toEqual([0, 2])
    expect(findGitGraphMatchIndexes(items, 'releas')).toEqual([1])
    expect(findGitGraphMatchIndexes(items, 'cccc')).toEqual([2])
    expect(findGitGraphMatchIndexes(items, '   ')).toEqual([])
  })

  it('steps through matches in both directions and wraps', () => {
    const matches = [0, 2]
    expect(stepGitGraphMatch(matches, -1, 1)).toBe(0)
    expect(stepGitGraphMatch(matches, 0, 1)).toBe(2)
    expect(stepGitGraphMatch(matches, 2, 1)).toBe(0)
    expect(stepGitGraphMatch(matches, 0, -1)).toBe(2)
    expect(stepGitGraphMatch([], 0, 1)).toBeUndefined()
  })
})
