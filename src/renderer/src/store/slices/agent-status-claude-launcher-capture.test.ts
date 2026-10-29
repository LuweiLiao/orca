import { expect, it } from 'vitest'
import type { AppState } from '../types'
import { createTestStore, makeTab } from './store-test-helpers'

it('keeps a ccb launch recipe when its Claude runtime reports Claude', () => {
  const store = createTestStore()
  store.setState({
    tabsByWorktree: {
      'wt-1': [makeTab({ id: 'tab-1', worktreeId: 'wt-1' })]
    }
  } as Partial<AppState>)
  const launchConfig = { agentCommand: 'ccb', agentArgs: '', agentEnv: {} }
  store.getState().registerAgentLaunchConfig('tab-1:leaf-1', launchConfig, {
    agentType: 'ccb',
    launchToken: 'launch-token-1',
    tabId: 'tab-1',
    leafId: 'leaf-1'
  })
  store.getState().setAgentStatus(
    'tab-1:leaf-1',
    { state: 'working', prompt: 'finish the task', agentType: 'claude' },
    'Claude Code',
    { updatedAt: 10, stateStartedAt: 10 },
    { tabId: 'tab-1', worktreeId: 'wt-1' },
    {
      providerSession: { key: 'session_id', id: 'claude-session-1' },
      launchToken: 'launch-token-1'
    }
  )

  // Why: without the recipe the pane would resume as native `claude --resume`.
  expect(store.getState().sleepingAgentSessionsByPaneKey['tab-1:leaf-1']).toMatchObject({
    agent: 'claude',
    launchConfig
  })
})
