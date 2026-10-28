import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { useConfirmationDialog } from '@/components/confirmation-dialog-context'
import { forgetProjectMapClosedChat } from '@/lib/project-map-closed-by-map'
import { hideProjectMapKeys, showProjectMapKeys } from '@/lib/project-map-hidden'
import type { ProjectMapAgent, ProjectMapGraph } from './project-map-graph'
import { projectMapAgentTitle } from './project-map-labels'
import {
  projectMapAgentHasTab,
  projectMapCloseConfirmation,
  projectMapHideKeysOf,
  projectMapHistoryIsWired
} from './project-map-node-actions'
import { projectMapHideKey } from './project-map-hidden-filter'
import { closeProjectMapAgent } from './project-map-close-run'
import { pushProjectMapUndoWithToast } from './use-project-map-undo'

export type ProjectMapNodeCommands = {
  close: (agent: ProjectMapAgent) => Promise<void>
  hide: (agent: ProjectMapAgent, withSubtree: boolean) => void
  showHidden: () => void
  removeFromMap: (agent: ProjectMapAgent) => void
}

/** Close, hide and remove, each with the confirmation and the undo it owes. */
export function useProjectMapNodeCommands(graph: ProjectMapGraph): ProjectMapNodeCommands {
  const confirm = useConfirmationDialog()
  return useMemo(
    () => ({
      close: async (agent) => {
        const title = projectMapAgentTitle(agent.card)
        const kind = projectMapCloseConfirmation(agent)
        if (
          kind &&
          !(await confirm({
            title: translate('projectMap.close.title', 'Close "{{title}}"?', { title }),
            description:
              kind === 'terminal'
                ? translate(
                    'projectMap.close.terminalDescription',
                    'This ends the agent running in the terminal. It cannot be reopened.'
                  )
                : translate(
                    'projectMap.close.runningDescription',
                    'The conversation is still running. Closing it stops the work in progress; you can reopen it from the map.'
                  ),
            confirmLabel: translate('projectMap.close.confirm', 'Close'),
            cancelVariant: 'ghost',
            confirmVariant: 'destructive'
          }))
        ) {
          return
        }
        const closed = closeProjectMapAgent(agent)
        if (closed?.reopen) {
          pushProjectMapUndoWithToast(
            { label: title, undo: closed.reopen },
            translate('projectMap.close.done', 'Closed "{{title}}"', { title })
          )
        }
      },
      hide: (agent, withSubtree) => {
        const keys = projectMapHideKeysOf(graph.agents, agent.card.paneKey, withSubtree)
        hideProjectMapKeys(keys)
        pushProjectMapUndoWithToast(
          { label: projectMapAgentTitle(agent.card), undo: () => showProjectMapKeys(keys) },
          translate('projectMap.hide.done', 'Hidden from the map')
        )
      },
      showHidden: () => showProjectMapKeys(graph.hiddenKeys ?? []),
      removeFromMap: (agent) => {
        const key = projectMapHideKey(agent)
        forgetProjectMapClosedChat(key)
        // A wire still ends at it, so only hiding takes it off the map.
        if (projectMapHistoryIsWired(graph.edges, agent.card.paneKey)) {
          hideProjectMapKeys([key])
        }
      }
    }),
    [confirm, graph]
  )
}

/** Delete on the map: closes a chat with a tab, takes a grey one off; anything else keeps it. */
export function projectMapDeleteKey(
  graph: ProjectMapGraph,
  id: string,
  commands: ProjectMapNodeCommands
): void {
  const agent = graph.agents.get(id)
  if (agent?.history) {
    commands.removeFromMap(agent)
  } else if (
    agent &&
    projectMapAgentHasTab(useAppStore.getState().unifiedTabsByWorktree, agent.card)
  ) {
    void commands.close(agent)
  }
}
