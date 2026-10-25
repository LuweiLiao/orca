import type { GitGraphResult } from '../../../../shared/git-graph-types'
import type {
  GitHistoryGraphColorId,
  GitHistoryItem,
  GitHistoryItemRef
} from '../../../../shared/git-history-types'
import { GIT_HISTORY_REF_COLOR } from '../../../../shared/git-history-types'

// Why: a refresh replays loaded pages so selection and scroll survive, but never unbounded.
export const GIT_GRAPH_MAX_REFRESH_PAGES = 20

/** Appends a cursor page to the pinned snapshot; refs and HEAD stay from the first page. */
export function appendGitGraphPage(previous: GitGraphResult, page: GitGraphResult): GitGraphResult {
  const seen = new Set(previous.items.map((item) => item.id))
  const appended = page.items.filter((item) => {
    if (seen.has(item.id)) {
      return false
    }
    seen.add(item.id)
    return true
  })
  return {
    ...previous,
    items: appended.length > 0 ? [...previous.items, ...appended] : previous.items,
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
    truncated: previous.truncated || page.truncated,
    isShallow: previous.isShallow || page.isShallow
  }
}

/** The HEAD marker ref; a detached HEAD has no branch ref, so synthesize one at its commit. */
export function getGitGraphHeadRef(result: GitGraphResult): GitHistoryItemRef | undefined {
  if (result.currentRef) {
    return result.currentRef
  }
  return result.headOid ? { id: 'HEAD', name: 'HEAD', revision: result.headOid } : undefined
}

/** Every ref takes its lane color; the checked-out ref keeps the reserved current-ref color. */
export function buildGitGraphColorMap(
  result: GitGraphResult
): Map<string, GitHistoryGraphColorId | undefined> {
  const colorMap = new Map<string, GitHistoryGraphColorId | undefined>()
  for (const ref of result.refs) {
    colorMap.set(ref.id, undefined)
  }
  for (const item of result.items) {
    for (const ref of item.references ?? []) {
      if (!colorMap.has(ref.id)) {
        colorMap.set(ref.id, undefined)
      }
    }
  }
  const headRef = getGitGraphHeadRef(result)
  if (headRef) {
    colorMap.set(headRef.id, GIT_HISTORY_REF_COLOR)
  }
  return colorMap
}

function itemMatches(item: GitHistoryItem, needle: string): boolean {
  if (item.id.startsWith(needle) || item.displayId?.toLowerCase().startsWith(needle)) {
    return true
  }
  const fields = [item.subject, item.message, item.author, item.authorEmail]
  if (fields.some((field) => field?.toLowerCase().includes(needle))) {
    return true
  }
  return (item.references ?? []).some((ref) => ref.name.toLowerCase().includes(needle))
}

/** Indexes of loaded commits matching the query; graph rows are never removed. */
export function findGitGraphMatchIndexes(
  items: readonly GitHistoryItem[],
  query: string
): number[] {
  const needle = query.trim().toLowerCase()
  if (!needle) {
    return []
  }
  const matches: number[] = []
  items.forEach((item, index) => {
    if (itemMatches(item, needle)) {
      matches.push(index)
    }
  })
  return matches
}

/** The match after (or before) `fromIndex`, wrapping around the loaded rows. */
export function stepGitGraphMatch(
  matches: readonly number[],
  fromIndex: number,
  direction: 1 | -1
): number | undefined {
  if (matches.length === 0) {
    return undefined
  }
  if (direction === 1) {
    return matches.find((index) => index > fromIndex) ?? matches[0]
  }
  for (let position = matches.length - 1; position >= 0; position -= 1) {
    if (matches[position]! < fromIndex) {
      return matches[position]
    }
  }
  return matches.at(-1)
}

export function getGitGraphCommitBody(item: GitHistoryItem): string {
  const message = item.message.replace(/\r\n/g, '\n')
  const newline = message.indexOf('\n')
  return newline === -1 ? '' : message.slice(newline + 1).trim()
}
