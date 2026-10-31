import { describe, expect, it } from 'vitest'
import { buildGrowthTree } from './growth-tree-build'
import { GROWTH_NOW, growthCard, growthFixture } from './growth-tree-fixture'
import { PROJECT_MAP_HISTORY_PANE_PREFIX } from './project-map-closed-chats'

describe('buildGrowthTree', () => {
  it('returns the same tree for the same input', () => {
    const a = buildGrowthTree(growthFixture())
    const b = buildGrowthTree(growthFixture())
    expect([...a.bars.keys()]).toEqual([...b.bars.keys()])
    expect(a.edges).toEqual(b.edges)
    expect(a.crossLinks).toEqual(b.crossLinks)
    expect(a.projects.map((project) => project.id)).toEqual(b.projects.map((project) => project.id))
  })

  it('pulls a child that began before its delegator up to the delegator, and the future back to now', () => {
    const tree = buildGrowthTree(growthFixture())
    expect(tree.bars.get('skewed')!.start).toBe(tree.bars.get('lead')!.start)
    expect(tree.bars.get('future')!.start).toBe(GROWTH_NOW)
    for (const bar of tree.bars.values()) {
      expect(bar.end).toBeGreaterThanOrEqual(bar.start)
      expect(bar.end).toBeLessThanOrEqual(GROWTH_NOW)
    }
  })

  it('keeps a worker that finished, and runs a working chat to now', () => {
    const tree = buildGrowthTree(growthFixture())
    const worker = tree.bars.get('worker')!
    expect(worker.running).toBe(false)
    expect(worker.end).toBe(3_000_000)
    expect(tree.bars.get('lead')!.end).toBe(GROWTH_NOW)
  })

  it('draws no derive line into a folder workspace', () => {
    const tree = buildGrowthTree(growthFixture())
    const derives = tree.edges.filter((edge) => edge.kind === 'derive')
    expect(derives.map((edge) => edge.id)).toEqual(['derive:a-main>a-feat'])
    expect(tree.lanes.get('a-notes')!.parentId).toBeNull()
    expect(tree.lanes.get('a-notes')!.kind).toBe('folder')
  })

  it('gives a merged chat one edge per source, the first as a hand-off', () => {
    const tree = buildGrowthTree(growthFixture())
    const into = tree.edges.filter((edge) => edge.to === 'merged')
    expect(into.map((edge) => `${edge.kind}:${edge.from}`).sort()).toEqual([
      'handoff:s1',
      'merge:s2',
      'merge:s3'
    ])
    for (const edge of into) {
      expect(edge.at).toBeGreaterThanOrEqual(tree.bars.get(edge.from)!.start)
      expect(edge.at).toBeLessThanOrEqual(tree.bars.get('merged')!.start)
    }
  })

  it('keeps a closed source as a history bar a hand-off still hangs from', () => {
    const tree = buildGrowthTree(growthFixture())
    const history = tree.bars.get(`${PROJECT_MAP_HISTORY_PANE_PREFIX}sess_closed`)
    expect(history?.history).toBe(true)
    expect(history!.start).toBeLessThanOrEqual(tree.bars.get('handed')!.start)
    expect(tree.edges.some((edge) => edge.from === history!.id && edge.to === 'handed')).toBe(true)
  })

  it('turns a delegation across projects into a cross link, not an edge', () => {
    const tree = buildGrowthTree(growthFixture())
    expect(tree.edges.some((edge) => edge.to === 'b-chat')).toBe(false)
    expect(tree.crossLinks).toMatchObject([
      {
        kind: 'delegate',
        from: 'lead',
        to: 'b-chat',
        fromProjectId: 'repo-a',
        toProjectId: 'repo-b'
      }
    ])
    expect(tree.bars.get('b-chat')!.unresolvedSource).toBe(false)
  })

  it('keeps chats the person hid in the blueprint, flagged', () => {
    const tree = buildGrowthTree(growthFixture(new Set(['sess_s1'])))
    expect(tree.bars.get('s1')!.hiddenInBlueprint).toBe(true)
    expect(tree.bars.get('s2')!.hiddenInBlueprint).toBe(false)
  })

  it('orders projects by latest activity and folds empty workspaces', () => {
    const tree = buildGrowthTree(growthFixture())
    expect(tree.projects.map((project) => project.id)).toEqual(['repo-a', 'repo-b'])
    const alpha = tree.projects.find((project) => project.id === 'repo-a')!
    expect(alpha.lastActivity).toBe(GROWTH_NOW)
    const quiet = growthFixture()
    quiet.snapshot.cards = quiet.snapshot.cards.filter((card) => card.paneKey !== 'future')
    expect(buildGrowthTree(quiet).projects.map((project) => project.id)).toEqual([
      'repo-b',
      'repo-a'
    ])
    expect(alpha.emptyLaneIds).toEqual(['a-empty'])
    expect(alpha.laneIds).toEqual(['a-main', 'a-feat', 'a-notes'])
    expect(alpha.workingCount).toBe(2)
  })

  it('marks a remote host lane and leaves a local one unmarked', () => {
    const tree = buildGrowthTree(growthFixture())
    expect(tree.lanes.get('b-main')).toMatchObject({ hostKind: 'ssh', hostLabel: 'build-box' })
    expect(tree.lanes.get('a-main')!.hostLabel).toBeNull()
  })

  it('places a chat with no recorded start beside its source', () => {
    const input = growthFixture()
    input.snapshot.cards.push(growthCard('undated', 'a-main', 0, { parentPaneKey: 'worker' }))
    const tree = buildGrowthTree(input)
    expect(tree.bars.get('undated')).toMatchObject({
      start: tree.bars.get('worker')!.start,
      startApprox: true
    })
  })

  it('handles an empty project and a project with one chat', () => {
    const tree = buildGrowthTree({
      ...growthFixture(),
      snapshot: { generatedAt: GROWTH_NOW, cards: [], workspaces: [] },
      projects: [{ id: 'repo-a', name: 'Alpha' }]
    })
    expect(tree.bars.size).toBe(0)
    expect(tree.projects).toHaveLength(1)
    const one = growthFixture()
    one.snapshot.cards = [growthCard('only', 'a-main', 1_000_000)]
    one.forks = { ...one.forks, lineage: new Map(), history: new Map() }
    expect(buildGrowthTree({ ...one, projects: [{ id: 'repo-a', name: 'Alpha' }] }).bars.size).toBe(
      1
    )
  })

  it('starts a lane at its workspace creation time, held to its first chat', () => {
    const tree = buildGrowthTree(growthFixture())
    expect(tree.lanes.get('a-feat')).toMatchObject({ start: 5_500_000, startApprox: false })
    expect(tree.lanes.get('a-notes')).toMatchObject({ start: 3_000_000, startApprox: false })
    const late = growthFixture()
    late.snapshot.workspaces!.find((w) => w.worktreeId === 'a-feat')!.createdAt = 9_000_000
    expect(buildGrowthTree(late).lanes.get('a-feat')).toMatchObject({ start: 6_000_000 })
  })

  it('falls back to the first chat, marked as an estimate, when creation time is missing', () => {
    const tree = buildGrowthTree(growthFixture())
    const main = tree.lanes.get('a-main')!
    expect(main.startApprox).toBe(true)
    expect(main.start).toBe(main.firstChatAt)
    const old = growthFixture()
    for (const workspace of old.snapshot.workspaces!) {
      delete workspace.createdAt
    }
    for (const lane of buildGrowthTree(old).lanes.values()) {
      expect(lane.startApprox).toBe(true)
      expect(lane.start).toBe(lane.firstChatAt)
    }
  })

  it('holds a creation time in the future to now, even for a workspace with no chats', () => {
    const input = growthFixture()
    input.snapshot.workspaces!.find((w) => w.worktreeId === 'a-empty')!.createdAt =
      GROWTH_NOW + 5_000
    expect(buildGrowthTree(input).lanes.get('a-empty')!.start).toBe(GROWTH_NOW)
  })

  it('begins a derived lane where its workspace was made', () => {
    const tree = buildGrowthTree(growthFixture())
    expect(tree.edges.find((edge) => edge.id === 'derive:a-main>a-feat')!.at).toBe(5_500_000)
  })

  it('keeps one pointer per pair, from the carrier, reading live if the newest does', () => {
    const tree = buildGrowthTree(growthFixture())
    expect(tree.references.map((reference) => reference.id)).toEqual([
      'reference:feat-chat>lead',
      'reference:merged>s3'
    ])
    const merged = tree.references.find((reference) => reference.from === 'merged')!
    expect(merged.live).toBe(true)
    const bar = tree.bars.get('merged')!
    expect(merged.at).toBeGreaterThanOrEqual(bar.start)
    expect(merged.at).toBeLessThanOrEqual(bar.end)
    expect(tree.references.find((reference) => reference.from === 'feat-chat')!.live).toBe(false)
    expect(tree.edges.map((edge) => edge.kind)).not.toContain('reference')
  })
})
