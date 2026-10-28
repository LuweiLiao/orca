import { describe, expect, it } from 'vitest'
import type { AgentSessionLineageEntry } from '../../../../shared/agent-session-fork'
import { projectMapBranchRelation, projectMapTurnsAfterCut } from './project-map-branch-compare'

const cut = (journalSequence: number, journalEpoch = 'e1') => ({
  journalItemId: `i${journalSequence}`,
  journalEpoch,
  journalSequence,
  messageCount: journalSequence
})

const handoff = (
  child: string,
  source: string,
  at: number,
  more: { sessionId: string; at: number }[] = []
): AgentSessionLineageEntry => ({
  childSessionId: child,
  sourceSessionId: source,
  originSessionId: source,
  mode: 'transcript',
  cut: cut(at),
  sourceProvider: 'claude',
  createdAt: 0,
  ...(more.length > 0
    ? {
        sources: [
          { sessionId: source, cut: cut(at), sourceProvider: 'claude' },
          ...more.map((m) => ({ sessionId: m.sessionId, cut: cut(m.at), sourceProvider: 'claude' }))
        ]
      }
    : {})
})

function lineageOf(entries: AgentSessionLineageEntry[]) {
  const byChild = new Map(entries.map((entry) => [entry.childSessionId, entry]))
  return (child: string) => byChild.get(child)
}

describe('projectMapBranchRelation', () => {
  it('finds the ancestor whichever side it is picked on, through a chain of hand-offs', () => {
    const of = lineageOf([handoff('mid', 'root', 4), handoff('leaf', 'mid', 9)])
    expect(projectMapBranchRelation('root', 'leaf', of)).toEqual({
      kind: 'ancestor',
      ancestor: 'root',
      descendant: 'leaf',
      cut: cut(4)
    })
    expect(projectMapBranchRelation('leaf', 'mid', of)).toMatchObject({
      kind: 'ancestor',
      ancestor: 'mid',
      cut: cut(9)
    })
  })

  it('takes the nearest common chat for two branches, each at its own cut', () => {
    const of = lineageOf([
      handoff('mid', 'root', 2),
      handoff('a', 'mid', 5),
      handoff('b', 'mid', 7),
      handoff('c', 'root', 3)
    ])
    expect(projectMapBranchRelation('a', 'b', of)).toEqual({
      kind: 'siblings',
      common: 'mid',
      cuts: { a: cut(5), b: cut(7) }
    })
    expect(projectMapBranchRelation('a', 'c', of)).toEqual({
      kind: 'siblings',
      common: 'root',
      cuts: { a: cut(2), c: cut(3) }
    })
  })

  it('follows every source of a merged hand-off, and says when two chats share none', () => {
    const of = lineageOf([handoff('merged', 'x', 4, [{ sessionId: 'y', at: 6 }])])
    expect(projectMapBranchRelation('y', 'merged', of)).toMatchObject({
      kind: 'ancestor',
      ancestor: 'y',
      cut: cut(6)
    })
    expect(projectMapBranchRelation('x', 'y', of)).toEqual({ kind: 'unrelated' })
  })
})

describe('projectMapTurnsAfterCut', () => {
  it('keeps the turns after the cut, and none when a rewind changed the history since', () => {
    const turns = [{ sequence: 1 }, { sequence: 4 }, { sequence: 8 }]
    expect(projectMapTurnsAfterCut(turns, cut(4), 'e1')).toEqual([{ sequence: 8 }])
    expect(projectMapTurnsAfterCut(turns, cut(4), 'e2')).toBeNull()
  })
})
