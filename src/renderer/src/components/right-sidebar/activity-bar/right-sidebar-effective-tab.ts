import type { ActiveRightSidebarTab } from '../../../../../shared/ui-chrome/ui-chrome-types'
import type { ActivityBarItem } from './activity-bar-buttons'

type ResolveRightSidebarEffectiveTabParams = {
  normalizedActiveTab: ActiveRightSidebarTab
  visibleItems: readonly Pick<ActivityBarItem, 'id'>[]
  activeFolderWorkspaceKey: string | null
  rememberedFolderTab: ActiveRightSidebarTab | null | undefined
  /** A bot's page opens on its first tab (Activity) until a tab is picked there. */
  leadWithFirstTab?: boolean
}

export function resolveRightSidebarEffectiveTab({
  normalizedActiveTab,
  visibleItems,
  activeFolderWorkspaceKey,
  rememberedFolderTab,
  leadWithFirstTab = false
}: ResolveRightSidebarEffectiveTabParams): ActiveRightSidebarTab {
  if (visibleItems.length === 0) {
    throw new Error('Right sidebar activity items must include at least one visible tab')
  }

  // Git Graph opens an editor tab, so it is never the panel's tab.
  const tabs = visibleItems.flatMap((item) => (item.id === 'git-graph' ? [] : [item.id]))
  const isVisible = (tab: ActiveRightSidebarTab): boolean => tabs.includes(tab)

  if (activeFolderWorkspaceKey && rememberedFolderTab && isVisible(rememberedFolderTab)) {
    return rememberedFolderTab
  }

  if (leadWithFirstTab && tabs[0]) {
    return tabs[0]
  }

  if (isVisible(normalizedActiveTab)) {
    return normalizedActiveTab
  }

  return tabs[0] ?? normalizedActiveTab
}
