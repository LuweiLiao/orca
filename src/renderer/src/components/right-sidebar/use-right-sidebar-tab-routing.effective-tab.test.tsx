// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ActivityBarItem } from './activity-bar-buttons'
import { useRightSidebarTabRouting } from './use-right-sidebar-tab-routing'

const store = vi.hoisted(() => ({
  state: {
    activeWorktreeId: 'worktree-graph',
    openGitGraph: vi.fn(),
    rightSidebarTab: 'source-control',
    rightSidebarRouteRequestId: 0,
    setRightSidebarTab: vi.fn(),
    showRightSidebarFiles: () => {},
    setRightSidebarEffectiveTab: (_tab: string | null) => {}
  }
}))
vi.mock('@/store', () => ({
  useAppStore: Object.assign((selector: (state: unknown) => unknown) => selector(store.state), {
    getState: () => store.state
  })
}))
vi.mock('./use-installed-plugin-route-reconciliation', () => ({
  useInstalledPluginRouteReconciliation: () => {}
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

it('opens the central graph without changing the folder sidebar route or its memory', () => {
  const visibleItems: ActivityBarItem[] = (['git-graph', 'explorer', 'vault'] as const).map(
    (id) => ({ id, icon: () => null, title: id, shortcut: '' })
  )
  const { result, rerender } = renderHook(() =>
    useRightSidebarTabRouting({
      visibleItems,
      activeFolderWorkspaceKey: 'folder-graph',
      pluginSystemEnabled: false,
      pluginFetchStatus: 'idle',
      installedPluginTabKeys: new Set()
    })
  )
  expect(result.current.effectiveTab).toBe('explorer')
  act(() => result.current.selectActivityTab('vault'))
  rerender()
  expect(result.current.effectiveTab).toBe('vault')
  store.state.setRightSidebarTab.mockClear()
  act(() => result.current.selectActivityTab('git-graph'))
  rerender()
  expect(store.state.openGitGraph).toHaveBeenCalledWith('worktree-graph')
  expect(store.state.setRightSidebarTab).not.toHaveBeenCalled()
  expect(result.current.effectiveTab).toBe('vault')
})

it('publishes Explorer when it renders as the fallback for a hidden stored tab', () => {
  const published: (string | null)[] = []
  store.state.setRightSidebarEffectiveTab = (tab) => published.push(tab)
  // A folder repo hides the git-only Source Control tab.
  const visibleItems: ActivityBarItem[] = (['explorer', 'vault'] as const).map((id) => ({
    id,
    icon: () => null,
    title: id,
    shortcut: ''
  }))
  const { result, unmount } = renderHook(() =>
    useRightSidebarTabRouting({
      visibleItems,
      activeFolderWorkspaceKey: null,
      pluginSystemEnabled: false,
      pluginFetchStatus: 'idle',
      installedPluginTabKeys: new Set()
    })
  )
  expect(result.current.effectiveTab).toBe('explorer')
  expect(published).toEqual(['explorer'])
  unmount()
  expect(published).toEqual(['explorer', null])
})
