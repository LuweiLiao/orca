import { useMemo } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { useConfirmationDialog } from '@/components/confirmation-dialog-context'
import {
  focusedConversationReferenceComposer,
  referenceConversationInFocusedChat
} from '@/components/native-chat/conversation-reference-insertion'
import { hideProjectMapKeys, showProjectMapKeys } from '@/lib/project-map-hidden'
import type { ProjectMapAgent, ProjectMapGraph } from './project-map-graph'
import {
  projectMapBatchCloseKinds,
  projectMapBatchPlan,
  projectMapStopRouteOf,
  runProjectMapBatchByHost,
  summarizeProjectMapBatch,
  type ProjectMapBatchActionId,
  type ProjectMapBatchContext,
  type ProjectMapBatchOutcome,
  type ProjectMapBatchPlan
} from './project-map-batch-plan'
import { projectMapBatchFailureText, projectMapBatchSkipText } from './project-map-batch-labels'
import { closeProjectMapAgent } from './project-map-close-run'
import { projectMapAgentHasTab, projectMapHideKeysOf } from './project-map-node-actions'
import { projectMapConversationReference } from './project-map-reference'
import { stopProjectMapRoute } from './project-map-stop-run'
import { pushProjectMapUndoWithToast } from './use-project-map-undo'

export type ProjectMapBatchCommands = {
  plan: (action: ProjectMapBatchActionId, agents: readonly ProjectMapAgent[]) => ProjectMapBatchPlan
  run: (action: ProjectMapBatchActionId, agents: readonly ProjectMapAgent[]) => Promise<boolean>
}

const hostOf = (agent: ProjectMapAgent): string =>
  agent.chat?.executionHostId ?? agent.card.executionHostId ?? 'local'

function batchContext(): ProjectMapBatchContext {
  const state = useAppStore.getState()
  return {
    hasTab: (agent) => projectMapAgentHasTab(state.unifiedTabsByWorktree, agent.card),
    orchestration: (agent) => state.runtimeAgentOrchestrationByPaneKey[agent.card.paneKey]
  }
}

/** One toast for the whole batch: its result when all went well, else who failed and why. */
function reportBatch(
  outcomes: readonly ProjectMapBatchOutcome<ProjectMapAgent>[],
  skippedText: string,
  done: (count: number) => string
): boolean {
  const summary = summarizeProjectMapBatch(outcomes)
  if (summary.failed > 0) {
    toast.error(projectMapBatchFailureText(summary))
    return false
  }
  const skipped = skippedText
    ? translate('projectMap.batch.skippedNote', ' Skipped: {{skipped}}.', { skipped: skippedText })
    : ''
  toast(`${done(summary.succeeded)}${skipped}`)
  return true
}

/** Mark read, close, hide, reference and stop over a selection, each host's chats in turn. */
export function useProjectMapBatchCommands(graph: ProjectMapGraph): ProjectMapBatchCommands {
  const confirm = useConfirmationDialog()
  return useMemo(() => {
    const plan: ProjectMapBatchCommands['plan'] = (action, agents) =>
      projectMapBatchPlan(action, agents, batchContext())

    const confirmed = (
      title: string,
      description: string,
      confirmLabel: string
    ): Promise<boolean> =>
      confirm({
        title,
        description,
        confirmLabel,
        cancelVariant: 'ghost',
        confirmVariant: 'destructive'
      })

    const close = async (targets: readonly ProjectMapAgent[], skippedText: string) => {
      const kinds = projectMapBatchCloseKinds(targets)
      if (kinds.running + kinds.terminal > 0) {
        const note = skippedText
          ? translate('projectMap.batch.skippedNote', ' Skipped: {{skipped}}.', {
              skipped: skippedText
            })
          : ''
        const ok = await confirmed(
          translate('projectMap.batch.closeTitle', 'Close {{count}} conversations?', {
            count: targets.length
          }),
          translate(
            'projectMap.batch.closeDescription',
            '{{running}} still running (closing stops their work; reopen them from the map) and {{terminal}} terminal agents that end for good.',
            { running: kinds.running, terminal: kinds.terminal }
          ) + note,
          translate('projectMap.close.confirm', 'Close')
        )
        if (!ok) {
          return false
        }
      }
      const reopeners: (() => Promise<void>)[] = []
      const outcomes = await runProjectMapBatchByHost(targets, hostOf, async (agent) => {
        const closed = closeProjectMapAgent(agent)
        if (!closed) {
          throw new Error(translate('projectMap.batch.error.noTab', 'it has no tab'))
        }
        if (closed.reopen) {
          reopeners.push(closed.reopen)
        }
      })
      const closedCount = outcomes.filter((outcome) => outcome.error === undefined).length
      if (reopeners.length > 0) {
        let pending = [...reopeners]
        pushProjectMapUndoWithToast(
          {
            label: translate('projectMap.batch.closeUndoLabel', '{{count}} conversations', {
              count: closedCount
            }),
            undo: async () => {
              const left: (() => Promise<void>)[] = []
              for (const reopen of pending) {
                await reopen().catch(() => left.push(reopen))
              }
              pending = left
              if (left.length > 0) {
                throw new Error('reopen failed')
              }
            }
          },
          translate('projectMap.batch.closeDone', 'Closed {{count}} conversations', {
            count: closedCount
          })
        )
      }
      const failed = outcomes.some((outcome) => outcome.error !== undefined)
      return failed ? reportBatch(outcomes, skippedText, () => '') : true
    }

    const stop = async (targets: readonly ProjectMapAgent[], skippedText: string) => {
      const ok = await confirmed(
        translate('projectMap.batch.stopTitle', 'Stop {{count}} conversations?', {
          count: targets.length
        }),
        translate(
          'projectMap.batch.stopDescription',
          'This stops the work in progress and ends any worker assignment. A stopped worker cannot be resumed.'
        ),
        translate('projectMap.stop.confirm', 'Stop')
      )
      if (!ok) {
        return false
      }
      const state = useAppStore.getState()
      const outcomes = await runProjectMapBatchByHost(targets, hostOf, async (agent) => {
        const route = projectMapStopRouteOf(
          agent,
          state.runtimeAgentOrchestrationByPaneKey[agent.card.paneKey]
        )
        if (!route) {
          throw new Error(translate('projectMap.batch.skip.notRunning', 'not running'))
        }
        await stopProjectMapRoute(route)
      })
      return reportBatch(outcomes, skippedText, (count) =>
        translate('projectMap.batch.stopDone', 'Stopped {{count}} conversations', { count })
      )
    }

    const reference = async (targets: readonly ProjectMapAgent[], skippedText: string) => {
      if ('refusal' in focusedConversationReferenceComposer()) {
        // The one refusal toast says which kind of problem the open chat has.
        await referenceConversationInFocusedChat(projectMapConversationReference(targets[0]!))
        return false
      }
      for (const agent of targets) {
        await referenceConversationInFocusedChat(projectMapConversationReference(agent))
      }
      const outcomes = targets.map((item) => ({ item }))
      return reportBatch(outcomes, skippedText, (count) =>
        translate('projectMap.batch.referenceDone', 'Referenced {{count}} conversations', {
          count
        })
      )
    }

    const run: ProjectMapBatchCommands['run'] = async (action, agents) => {
      const { targets, skipped } = plan(action, agents)
      if (targets.length === 0) {
        toast.error(
          translate('projectMap.batch.nothing', 'Nothing to do: {{skipped}}.', {
            skipped: projectMapBatchSkipText(skipped)
          })
        )
        return false
      }
      const skippedText = projectMapBatchSkipText(skipped)
      switch (action) {
        case 'mark-read': {
          useAppStore.getState().acknowledgeAgents(
            targets.map((agent) => agent.card.paneKey),
            undefined,
            'explicit'
          )
          return reportBatch(
            targets.map((item) => ({ item })),
            skippedText,
            (count) =>
              translate('projectMap.batch.markReadDone', 'Marked {{count}} as read', { count })
          )
        }
        case 'hide': {
          const keys = [
            ...new Set(
              targets.flatMap((agent) =>
                projectMapHideKeysOf(graph.agents, agent.card.paneKey, false)
              )
            )
          ]
          hideProjectMapKeys(keys)
          pushProjectMapUndoWithToast(
            {
              label: translate('projectMap.batch.hideUndoLabel', '{{count}} conversations', {
                count: targets.length
              }),
              undo: () => showProjectMapKeys(keys)
            },
            translate('projectMap.batch.hideDone', 'Hid {{count}} conversations from the map', {
              count: targets.length
            })
          )
          return true
        }
        case 'close':
          return close(targets, skippedText)
        case 'stop':
          return stop(targets, skippedText)
        case 'reference':
          return reference(targets, skippedText)
      }
    }
    return { plan, run }
  }, [confirm, graph.agents])
}
