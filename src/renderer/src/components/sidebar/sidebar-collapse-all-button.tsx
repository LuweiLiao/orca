import React, { useCallback } from 'react'
import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { LINEAGE_GROUP_PREFIX } from '../../../../shared/sidebar-list/group-keys'
import { getRenderedLineageChipKeys } from './child-workspaces-toggle-target'
import {
  setAllWorktreeAgentListsCollapsed,
  useWorktreeAgentListsBulkCollapsed
} from './worktree-card-agents-expansion-state'

/** Folds or unfolds every card's agent list and child workspaces at once. */
export function SidebarCollapseAllButton({
  preserveWorkspaceBoardOpen
}: {
  preserveWorkspaceBoardOpen: boolean
}): React.JSX.Element {
  const bulkCollapsed = useWorktreeAgentListsBulkCollapsed()
  const collapsing = bulkCollapsed !== true
  const label = collapsing
    ? translate('auto.components.sidebar.SidebarHeader.collapseAll', 'Collapse all agents')
    : translate('auto.components.sidebar.SidebarHeader.expandAll', 'Expand all agents')

  const handleClick = useCallback(() => {
    const store = useAppStore.getState()
    const lineageKeys = collapsing
      ? getRenderedLineageChipKeys(store)
      : [...store.collapsedGroups].filter((key) => key.startsWith(LINEAGE_GROUP_PREFIX))
    store.setGroupsCollapsed(lineageKeys, collapsing)
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
          className="text-muted-foreground"
          aria-label={label}
          data-workspace-board-preserve-open={preserveWorkspaceBoardOpen ? '' : undefined}
          onClick={handleClick}
        >
          <Icon className="size-3.5" strokeWidth={2.25} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
