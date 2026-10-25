import { describe, expect, it, vi } from 'vitest'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'
import { settingsWithRuntime } from './browser-slice-test-harness'
import { createEditorTabsStore } from './editor-slice-test-harness'
import { drawTabsFromMain } from './tabs-drawn-from-main.test-fixture'
import { makeWorktree } from './worktrees-slice-test-fixtures'
import type { AppState } from '../types'

// Main's answer to the window's layout commands, as a switch-on build sends them.
vi.mock('@/runtime/runtime-rpc-client', async (importOriginal) =>
  (
    await import('@/runtime/layout-apply-test-transport.test-fixture')
  ).runtimeRpcClientWithLayoutApply(await importOriginal())
)
vi.mock('@/runtime/runtime-layout-client', async (importOriginal) =>
  (
    await import('@/runtime/layout-apply-test-transport.test-fixture')
  ).runtimeLayoutClientWithTestFrames(await importOriginal())
)

const { toastErrorMock } = vi.hoisted(() => ({ toastErrorMock: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: toastErrorMock } }))

const LOCAL_GRAPH_ID = 'git-graph:wt-1:local:local'

function graphTabs(state: AppState, worktreeId = 'wt-1') {
  return (state.unifiedTabsByWorktree[worktreeId] ?? []).filter(
    (tab) => tab.contentType === 'git-graph'
  )
}

describe('openGitGraph', () => {
  it('keeps one graph tab per workspace and focuses it on reopen', async () => {
    const store = createEditorTabsStore()
    const main = await drawTabsFromMain(store)

    store.getState().openGitGraph('wt-1')
    await main.settle()
    store.getState().openFile({
      filePath: '/repo/other.ts',
      relativePath: 'other.ts',
      worktreeId: 'wt-1',
      language: 'typescript',
      mode: 'edit'
    })
    await main.settle()
    store.getState().openGitGraph('wt-1')
    await main.settle()

    const graphFiles = store.getState().openFiles.filter((file) => file.mode === 'git-graph')
    expect(graphFiles).toEqual([
      expect.objectContaining({
        id: LOCAL_GRAPH_ID,
        worktreeId: 'wt-1',
        runtimeEnvironmentId: null,
        operationProvenance: expect.objectContaining({
          generation: expect.objectContaining({
            route: { executionHostId: 'local', runtimeEnvironmentId: null }
          })
        })
      })
    ])
    expect(graphTabs(store.getState())).toEqual([
      expect.objectContaining({ entityId: LOCAL_GRAPH_ID, executionHostId: 'local' })
    ])
    expect(store.getState().activeFileId).toBe(LOCAL_GRAPH_ID)
    main.close()
  })

  it('focuses the graph in its split group instead of opening a second copy', async () => {
    const store = createEditorTabsStore()
    const main = await drawTabsFromMain(store)

    store.getState().openGitGraph('wt-1')
    await main.settle()
    const graphGroupId = graphTabs(store.getState())[0]?.groupId
    expect(graphGroupId).toBeTruthy()
    store.getState().createEmptySplitGroup('wt-1', graphGroupId!, 'right')
    await main.settle()
    expect(store.getState().activeGroupIdByWorktree['wt-1']).not.toBe(graphGroupId)

    store.getState().openGitGraph('wt-1')
    await main.settle()

    expect(graphTabs(store.getState())).toHaveLength(1)
    expect(store.getState().activeGroupIdByWorktree['wt-1']).toBe(graphGroupId)
    main.close()
  })

  it('gives each workspace its own graph tab', async () => {
    const store = createEditorTabsStore()
    const main = await drawTabsFromMain(store)
    store.setState({
      worktreesByRepo: {
        'repo-1': [
          makeWorktree({ id: 'wt-1', repoId: 'repo-1', path: '/repo' }),
          makeWorktree({ id: 'wt-2', repoId: 'repo-1', path: '/repo-wt-2' })
        ]
      }
    })

    store.getState().openGitGraph('wt-1')
    store.getState().openGitGraph('wt-2')
    await main.settle()

    expect(
      store
        .getState()
        .openFiles.filter((file) => file.mode === 'git-graph')
        .map((file) => [file.id, file.worktreeId])
    ).toEqual([
      [LOCAL_GRAPH_ID, 'wt-1'],
      ['git-graph:wt-2:local:local', 'wt-2']
    ])
    expect(graphTabs(store.getState(), 'wt-2')).toHaveLength(1)
    main.close()
  })

  it('keeps a reopened local graph local while another runtime is active', async () => {
    const store = createEditorTabsStore()
    const main = await drawTabsFromMain(store)

    store.getState().openGitGraph('wt-1')
    await main.settle()
    store.getState().closeFile(LOCAL_GRAPH_ID)
    await main.settle()
    store.setState({ settings: settingsWithRuntime('env-remote') })

    expect(store.getState().reopenClosedEditorTab('wt-1')).toBe(true)
    await main.settle()

    expect(store.getState().openFiles.filter((file) => file.mode === 'git-graph')).toEqual([
      expect.objectContaining({ id: LOCAL_GRAPH_ID, runtimeEnvironmentId: null })
    ])
    main.close()
  })

  it('opens nothing when the workspace owner cannot be resolved', () => {
    const store = createEditorTabsStore()
    const removedFolder = folderWorkspaceKey('removed-folder')

    store.getState().openGitGraph(removedFolder)

    expect(store.getState().openFiles).toEqual([])
    expect(graphTabs(store.getState(), removedFolder)).toEqual([])
    expect(toastErrorMock).toHaveBeenCalled()
  })
})
