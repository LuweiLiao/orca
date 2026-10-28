import { useCallback } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { useConfirmationDialog } from '@/components/confirmation-dialog-context'
import type { ProjectMapAgent } from './project-map-graph'
import { projectMapAgentTitle } from './project-map-labels'
import { projectMapStopRouteOf } from './project-map-batch-plan'
import { stopProjectMapRoute } from './project-map-stop-run'

/** Stop on one node: confirmed first, never put on the undo stack since a stop cannot be taken back. */
export function useProjectMapStopCommand(): (agent: ProjectMapAgent) => Promise<void> {
  const confirm = useConfirmationDialog()
  return useCallback(
    async (agent) => {
      const route = projectMapStopRouteOf(
        agent,
        useAppStore.getState().runtimeAgentOrchestrationByPaneKey[agent.card.paneKey]
      )
      if (!route) {
        return
      }
      const title = projectMapAgentTitle(agent.card)
      const confirmed = await confirm({
        title: translate('projectMap.stop.title', 'Stop "{{title}}"?', { title }),
        description:
          route.kind === 'worker'
            ? translate(
                'projectMap.stop.workerDescription',
                'This ends the worker for its assignment. It cannot be resumed.'
              )
            : translate(
                'projectMap.stop.chatDescription',
                'This stops the work the conversation has in progress. You can keep talking to it afterwards.'
              ),
        confirmLabel: translate('projectMap.stop.confirm', 'Stop'),
        cancelVariant: 'ghost',
        confirmVariant: 'destructive'
      })
      if (!confirmed) {
        return
      }
      try {
        await stopProjectMapRoute(route)
        toast(translate('projectMap.stop.done', 'Stopped "{{title}}"', { title }))
      } catch (error) {
        toast.error(
          translate('projectMap.stop.failed', 'Could not stop "{{title}}": {{reason}}', {
            title,
            reason: error instanceof Error ? error.message : String(error)
          })
        )
      }
    },
    [confirm]
  )
}
