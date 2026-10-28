import { useEffect, useMemo, useState } from 'react'
import type { GitFileStatus } from '../../../../shared/git-status-types'
import type { Tab } from '../../../../shared/tab-types'
import type { TabBarProps } from './tab-bar-props'
import {
  buildOrderedTabItems,
  buildTabDropIndicators,
  buildTabStripLayoutKey,
  findActiveVisibleTabId,
  type TabBarItem
} from './tab-bar-item-model'
import type { DropIndicator } from './drop-indicator'
import { sameStringArray } from '@/runtime/web-session-tabs-sync/state-equality-core'
import { revealWorkerTab, useHiddenWorkerTabIds } from './worker-tab-visibility'

export type TabBarItemProjection = {
  orderedItems: TabBarItem[]
  sortableIds: string[]
  dropIndicatorByVisibleId: Map<string, DropIndicator>
  activeVisibleTabId: string | null
  tabStripLayoutKey: string
}

function isHiddenWorkerItem(item: TabBarItem, hidden: ReadonlySet<string>): boolean {
  return hidden.has(item.id) || hidden.has(item.unifiedTabId)
}

export function useTabBarItemProjection({
  props,
  resolvedGroupId,
  unifiedTabs,
  unifiedTabByVisibleId,
  generatedTabTitlesEnabled,
  statusByRelativePath
}: {
  props: TabBarProps
  resolvedGroupId: string
  unifiedTabs: readonly Tab[]
  unifiedTabByVisibleId: Map<string, Tab>
  generatedTabTitlesEnabled: boolean
  statusByRelativePath: Map<string, GitFileStatus>
}): TabBarItemProjection {
  const {
    tabs,
    editorFiles,
    browserTabs,
    agentSessionTabs,
    tabBarOrder,
    hoveredTabInsertion,
    activeTabId,
    activeFileId,
    activeBrowserTabId,
    activeSimulatorTabId,
    activeTabType,
    expandedPaneByTabId
  } = props
  const terminalMap = useMemo(() => new Map(tabs.map((tab) => [tab.id, tab])), [tabs])
  const editorMap = useMemo(
    () => new Map((editorFiles ?? []).map((file) => [file.tabId ?? file.id, file])),
    [editorFiles]
  )
  const browserMap = useMemo(
    () => new Map((browserTabs ?? []).map((tab) => [tab.id, tab])),
    [browserTabs]
  )
  const agentSessionMap = useMemo(
    () => new Map((agentSessionTabs ?? []).map((tab) => [tab.id, tab])),
    [agentSessionTabs]
  )
  const terminalIds = useMemo(() => tabs.map((tab) => tab.id), [tabs])
  const editorFileIds = useMemo(
    () => editorFiles?.map((file) => file.tabId ?? file.id) ?? [],
    [editorFiles]
  )
  const browserTabIds = useMemo(() => browserTabs?.map((tab) => tab.id) ?? [], [browserTabs])
  const simulatorTabIds = useMemo(
    () =>
      unifiedTabs
        .filter((tab) => tab.groupId === resolvedGroupId && tab.contentType === 'simulator')
        .map((tab) => tab.id),
    [unifiedTabs, resolvedGroupId]
  )
  const agentSessionTabIds = useMemo(
    () => agentSessionTabs?.map((tab) => tab.id) ?? [],
    [agentSessionTabs]
  )
  const hiddenWorkerTabIds = useHiddenWorkerTabIds()
  const allItems = useMemo(
    () =>
      buildOrderedTabItems({
        tabBarOrder,
        terminalIds,
        editorFileIds,
        browserTabIds,
        simulatorTabIds,
        agentSessionTabIds,
        terminalMap,
        editorMap,
        browserMap,
        agentSessionMap,
        unifiedTabByVisibleId
      }),
    [
      tabBarOrder,
      terminalIds,
      editorFileIds,
      browserTabIds,
      simulatorTabIds,
      agentSessionTabIds,
      terminalMap,
      editorMap,
      browserMap,
      agentSessionMap,
      unifiedTabByVisibleId
    ]
  )
  const activeAmongAll = useMemo(
    () =>
      findActiveVisibleTabId(allItems, {
        activeTabId,
        activeFileId,
        activeBrowserTabId,
        activeSimulatorTabId,
        activeTabType
      }),
    [activeBrowserTabId, activeFileId, activeSimulatorTabId, activeTabId, activeTabType, allItems]
  )
  const orderedItems = useMemo(
    () =>
      hiddenWorkerTabIds.size === 0
        ? allItems
        : allItems.filter(
            (item) => item.id === activeAmongAll || !isHiddenWorkerItem(item, hiddenWorkerTabIds)
          ),
    [activeAmongAll, allItems, hiddenWorkerTabIds]
  )
  // Why: once a worker tab is shown (sidebar click, shortcut), it stays in the strip after focus moves on.
  const activeItem = allItems.find((item) => item.id === activeAmongAll)
  const activeHiddenWorkerIds =
    activeItem && isHiddenWorkerItem(activeItem, hiddenWorkerTabIds)
      ? `${activeItem.id} ${activeItem.unifiedTabId}`
      : null
  useEffect(() => {
    for (const id of activeHiddenWorkerIds?.split(' ') ?? []) {
      revealWorkerTab(id)
    }
  }, [activeHiddenWorkerIds])
  const orderedIds = useMemo(() => orderedItems.map((item) => item.id), [orderedItems])
  // Why: dnd-kit re-renders every tab when this array's identity changes, and the items rebuild on any tab write.
  const [sortableIds, setSortableIds] = useState(orderedIds)
  if (!sameStringArray(sortableIds, orderedIds)) {
    setSortableIds(orderedIds)
  }
  const activeIndicator =
    hoveredTabInsertion?.groupId === resolvedGroupId ? hoveredTabInsertion : null
  const dropIndicatorByVisibleId = useMemo(
    () => buildTabDropIndicators(orderedItems, activeIndicator),
    [activeIndicator, orderedItems]
  )
  // Why: the active item is never filtered out, so its id among all items is its visible id.
  const activeVisibleTabId = activeAmongAll
  const tabStripLayoutKey = useMemo(
    () =>
      buildTabStripLayoutKey(
        orderedItems,
        generatedTabTitlesEnabled,
        expandedPaneByTabId,
        statusByRelativePath
      ),
    [expandedPaneByTabId, generatedTabTitlesEnabled, orderedItems, statusByRelativePath]
  )

  return {
    orderedItems,
    sortableIds,
    dropIndicatorByVisibleId,
    activeVisibleTabId,
    tabStripLayoutKey
  }
}
