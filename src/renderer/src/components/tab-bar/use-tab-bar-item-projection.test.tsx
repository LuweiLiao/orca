// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useAppStore } from '@/store'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import type { TabBarProps } from './tab-bar-props'
import { useTabBarItemProjection } from './use-tab-bar-item-projection'
import { resetRevealedWorkerTabsForTests } from './worker-tab-visibility'

const NOOP = (): void => {}

function terminalTab(id: string, sortOrder: number): TerminalTab & { unifiedTabId?: string } {
  return {
    id,
    unifiedTabId: `unified-${id}`,
    ptyId: null,
    worktreeId: 'wt-1',
    title: 'zsh',
    customTitle: null,
    color: null,
    sortOrder,
    createdAt: 0
  }
}

/** Rebuilt per call, like the store's tab list: equal content, never the same objects. */
function buildProps(ids: string[], activeTabId = ids[0] ?? null): TabBarProps {
  return {
    tabs: ids.map((id, index) => terminalTab(id, index)),
    tabBarOrder: [...ids],
    activeTabId,
    activeTabType: 'terminal',
    worktreeId: 'wt-1',
    expandedPaneByTabId: {},
    onActivate: NOOP,
    onClose: NOOP,
    onCloseOthers: NOOP,
    onCloseToRight: NOOP,
    onCloseToLeft: NOOP,
    onNewTerminalTab: NOOP,
    onNewBrowserTab: NOOP,
    onSetCustomTitle: NOOP,
    onSetTabColor: NOOP,
    onTogglePaneExpand: NOOP
  }
}

function renderProjection(initialIds: string[]): {
  sortableIds: () => string[]
  rerenderWith: (ids: string[]) => void
} {
  const { result, rerender } = renderHook(
    (ids: string[]) =>
      useTabBarItemProjection({
        props: buildProps(ids),
        resolvedGroupId: 'group-1',
        unifiedTabs: [],
        unifiedTabByVisibleId: new Map(),
        generatedTabTitlesEnabled: false,
        statusByRelativePath: new Map()
      }),
    { initialProps: initialIds }
  )
  return {
    sortableIds: () => result.current.sortableIds,
    rerenderWith: (ids) => rerender(ids)
  }
}

describe('tab strip sortable ids', () => {
  it('hands dnd-kit the same array while the ids are unchanged', () => {
    const projection = renderProjection(['term-1', 'term-2'])
    const first = projection.sortableIds()

    projection.rerenderWith(['term-1', 'term-2'])

    // A new array here re-renders every tab through dnd-kit's context, even with identical ids.
    expect(projection.sortableIds()).toBe(first)
  })

  it('hands dnd-kit a new array when a tab is added', () => {
    const projection = renderProjection(['term-1', 'term-2'])

    projection.rerenderWith(['term-1', 'term-2', 'term-3'])

    expect(projection.sortableIds()).toEqual(['term-1', 'term-2', 'term-3'])
  })

  it('hands dnd-kit a new array when the tabs are reordered', () => {
    const projection = renderProjection(['term-1', 'term-2'])

    projection.rerenderWith(['term-2', 'term-1'])

    expect(projection.sortableIds()).toEqual(['term-2', 'term-1'])
  })
})

describe('orchestration worker tabs', () => {
  afterEach(() => {
    act(() => useAppStore.setState({ runtimeAgentOrchestrationByPaneKey: {} }))
    resetRevealedWorkerTabsForTests()
  })

  it('stay out of the strip until opened, then stay after focus moves back', () => {
    act(() =>
      useAppStore.setState({
        runtimeAgentOrchestrationByPaneKey: {
          [makePaneKey('worker', '11111111-1111-4111-8111-111111111111')]: {
            taskId: 'task-1',
            dispatchId: 'ctx-1'
          }
        }
      })
    )
    const ids = ['coordinator', 'worker', 'other']
    const { result, rerender } = renderHook(
      (activeTabId: string) =>
        useTabBarItemProjection({
          props: buildProps(ids, activeTabId),
          resolvedGroupId: 'group-1',
          unifiedTabs: [],
          unifiedTabByVisibleId: new Map(),
          generatedTabTitlesEnabled: false,
          statusByRelativePath: new Map()
        }),
      { initialProps: 'coordinator' }
    )
    const visible = () => result.current.orderedItems.map((item) => item.id)

    expect(visible()).toEqual(['coordinator', 'other'])

    rerender('worker')
    expect(visible()).toEqual(ids)
    expect(result.current.activeVisibleTabId).toBe('worker')

    rerender('coordinator')
    expect(visible()).toEqual(ids)
  })
})
