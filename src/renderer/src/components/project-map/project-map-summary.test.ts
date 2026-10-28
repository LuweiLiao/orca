import { describe, expect, it } from 'vitest'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import type { ProjectMapAgent } from './project-map-graph'
import { projectMapAgentActions } from './project-map-node-actions'
import { projectMapHandoffInstruction, projectMapSummaryBlock } from './project-map-summary'
import {
  noteProjectMapSummary,
  openProjectMapSummary,
  projectMapSummaryState,
  setProjectMapSummaryIndex
} from './project-map-summary-state'

function agent(
  over: Partial<ProjectMapAgent> = {},
  card: Partial<DashboardCard> = {}
): ProjectMapAgent {
  return {
    card: {
      paneKey: 'a1',
      ptyId: null,
      agentType: 'claude',
      bucket: 'done',
      dotState: 'done',
      task: 'Do it',
      repoId: 'repo',
      worktreeId: 'main',
      tabId: 'tab-a1',
      leafId: null,
      repoName: 'repo',
      worktreeName: 'main',
      hostKind: 'local',
      executionHostId: 'local',
      startedAt: 1,
      finishedAt: null,
      stateChangedAt: 0,
      unseen: false,
      ...card
    },
    chat: { sessionId: 's1', agent: 'claude', executionHostId: 'local' },
    parentPaneKey: null,
    hasUnresolvedParent: false,
    childPaneKeys: [],
    ...over
  }
}

describe('projectMapSummaryBlock', () => {
  it('lets a chat on a host that knows summaries be summarized', () => {
    expect(projectMapSummaryBlock(agent(), false)).toBeNull()
  })

  it('greys out a host without the capability, naming the reason, never running locally', () => {
    expect(projectMapSummaryBlock(agent(), true)).toBe('summary-host-too-old')
  })

  it('has nothing to summarize for a terminal agent or an SSH host', () => {
    expect(projectMapSummaryBlock(agent({ chat: undefined }), false)).toBe('no-chat')
    expect(projectMapSummaryBlock(agent({}, { hostKind: 'ssh' }), false)).toBe('remote-host')
  })

  it('still offers a closed chat that has its record, so its summary can be read', () => {
    expect(projectMapSummaryBlock(agent({ history: true }), false)).toBeNull()
  })

  it('is one more menu item, added after the existing ones', () => {
    const actions = projectMapAgentActions(agent(), { hasTab: true, hostTooOld: false })
    const ids = actions.map((action) => action.id)
    expect(ids.indexOf('summary')).toBe(ids.indexOf('reference') + 1)
    const old = projectMapAgentActions(agent(), {
      hasTab: true,
      hostTooOld: false,
      summaryHostTooOld: true
    }).find((action) => action.id === 'summary')
    expect(old).toEqual({ id: 'summary', enabled: false, reason: 'summary-host-too-old' })
  })
})

describe('projectMapHandoffInstruction', () => {
  it('leaves the instruction alone without a summary', () => {
    expect(projectMapHandoffInstruction({ summary: null, instruction: 'go', references: [] })).toBe(
      'go'
    )
    expect(projectMapHandoffInstruction({ summary: '  ', instruction: 'go', references: [] })).toBe(
      'go'
    )
  })

  it('puts the summary text before the person’s own words', () => {
    expect(
      projectMapHandoffInstruction({
        summary: 'Goal: map',
        instruction: 'continue',
        references: []
      })
    ).toBe('Summary of the previous chat:\n\nGoal: map\n\ncontinue')
  })

  it('hands over the summary alone when nothing else was typed', () => {
    expect(
      projectMapHandoffInstruction({ summary: 'Goal: map', instruction: '', references: [] })
    ).toBe('Summary of the previous chat:\n\nGoal: map')
  })
})

describe('project map summary state', () => {
  it('marks a chat when its summary is made and unmarks it when it is gone', () => {
    setProjectMapSummaryIndex(new Set(['s1']), new Set(['old-host']))
    expect(projectMapSummaryState().summarized.has('s1')).toBe(true)
    noteProjectMapSummary('s2', true)
    expect(projectMapSummaryState().summarized.has('s2')).toBe(true)
    noteProjectMapSummary('s2', false)
    expect(projectMapSummaryState().summarized.has('s2')).toBe(false)
    expect(projectMapSummaryState().unsupportedHosts.has('old-host')).toBe(true)
  })

  it('keeps the same state object when an index re-read finds nothing new', () => {
    setProjectMapSummaryIndex(new Set(['s1']), new Set())
    const before = projectMapSummaryState()
    setProjectMapSummaryIndex(new Set(['s1']), new Set())
    expect(projectMapSummaryState()).toBe(before)
    openProjectMapSummary('a1')
    expect(projectMapSummaryState().openPaneKey).toBe('a1')
    openProjectMapSummary(null)
  })
})
