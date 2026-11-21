import React, { useCallback } from 'react'
import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslate } from '@/i18n/use-translate'
import { readRuntimeStatuses } from '@/store/slices/runtime-status/views/runtime-status-owner'
import { LINEAGE_GROUP_PREFIX } from '../../../../../shared/sidebar-list/sections/group-keys'
import { getRenderedLineageChipKeys } from '../workspace-card/identity/child-workspaces-toggle-target'
import {
  setAllWorktreeAgentListsCollapsed,
  useWorktreeAgentListsBulkCollapsed
} from '../workspace-card/activity/worktree-card-agents-expansion-state'

/** Folds or unfolds every card's agent list and child workspaces at once. */
export function SidebarCollapseAllButton({
  preserveWorkspaceBoardOpen
}: {
  preserveWorkspaceBoardOpen: boolean
}): React.JSX.Element {
  const t = useTranslate()
  const bulkCollapsed = useWorktreeAgentListsBulkCollapsed()
  const collapsing = bulkCollapsed !== true
  const label = collapsing
    ? t('auto.components.sidebar.SidebarHeader.collapseAll', 'Collapse all agents')
    : t('auto.components.sidebar.SidebarHeader.expandAll', 'Expand all agents')

  const handleClick = useCallback(() => {
    const store = useAppStore.getState()
    const lineageKeys = collapsing
      ? getRenderedLineageChipKeys(store, readRuntimeStatuses())
      : [...store.collapsedGroups].filter((key) => key.startsWith(LINEAGE_GROUP_PREFIX))
    const next = new Set(store.collapsedGroups)
    for (const key of lineageKeys) {
      if (collapsing) {
        next.add(key)
      } else {
        next.delete(key)
      }
    }
    store.setCollapsedGroups(next)
    setAllWorktreeAgentListsCollapsed(collapsing)
  }, [collapsing])

  const Icon = collapsing ? ChevronsDownUp : ChevronsUpDown
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          type="button"
          aria-label={label}
          data-workspace-board-preserve-open={preserveWorkspaceBoardOpen ? '' : undefined}
          onClick={handleClick}
        >
          <Icon className="size-3.5 text-muted-foreground" strokeWidth={2.25} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
