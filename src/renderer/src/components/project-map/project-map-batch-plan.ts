import type { AgentStatusOrchestrationContext } from '../../../../shared/agent-status-types'
import type { ProjectMapAgent } from './project-map-graph'
import { projectMapCloseConfirmation } from './project-map-node-actions'
import { projectMapConversationReference } from './project-map-reference'
import {
  projectMapStopPlan,
  type ProjectMapStopBlock,
  type ProjectMapStopRoute
} from './project-map-stop-route'

export type ProjectMapBatchActionId = 'mark-read' | 'close' | 'hide' | 'reference' | 'stop'

export type ProjectMapBatchSkip = { agent: ProjectMapAgent; reason: string }

export type ProjectMapBatchPlan = {
  /** Chats the action applies to, in selection order. */
  targets: ProjectMapAgent[]
  skipped: ProjectMapBatchSkip[]
}

export type ProjectMapBatchContext = {
  hasTab: (agent: ProjectMapAgent) => boolean
  orchestration: (agent: ProjectMapAgent) => AgentStatusOrchestrationContext | undefined
}

type Skip = 'closed' | 'no-tab' | 'read' | 'no-chat' | 'not-running' | ProjectMapStopBlock

function skipReason(
  action: ProjectMapBatchActionId,
  agent: ProjectMapAgent,
  context: ProjectMapBatchContext
): Skip | null {
  switch (action) {
    case 'mark-read':
      return agent.history ? 'closed' : agent.card.unseen ? null : 'read'
    case 'close':
      return agent.history ? 'closed' : context.hasTab(agent) ? null : 'no-tab'
    case 'hide':
      return null
    case 'reference':
      return projectMapConversationReference(agent) ? null : 'no-chat'
    case 'stop': {
      const plan = projectMapStopPlan(agent, context.orchestration(agent))
      return plan === null ? 'not-running' : 'block' in plan ? plan.block : null
    }
  }
}

/** Splits a selection into the chats an action applies to and those it leaves alone, with why. */
export function projectMapBatchPlan(
  action: ProjectMapBatchActionId,
  agents: readonly ProjectMapAgent[],
  context: ProjectMapBatchContext
): ProjectMapBatchPlan {
  const plan: ProjectMapBatchPlan = { targets: [], skipped: [] }
  for (const agent of agents) {
    const reason = skipReason(action, agent, context)
    if (reason) {
      plan.skipped.push({ agent, reason })
    } else {
      plan.targets.push(agent)
    }
  }
  return plan
}

export type ProjectMapBatchCloseKinds = { terminal: number; running: number }

/** How many of the chats to close end a terminal agent or interrupt work in progress. */
export function projectMapBatchCloseKinds(
  targets: readonly ProjectMapAgent[]
): ProjectMapBatchCloseKinds {
  const kinds = { terminal: 0, running: 0 }
  for (const agent of targets) {
    const kind = projectMapCloseConfirmation(agent)
    if (kind) {
      kinds[kind] += 1
    }
  }
  return kinds
}

/** A stop's route; absent when the chat cannot be stopped from the map. */
export function projectMapStopRouteOf(
  agent: ProjectMapAgent,
  orchestration: AgentStatusOrchestrationContext | undefined
): ProjectMapStopRoute | null {
  const plan = projectMapStopPlan(agent, orchestration)
  return plan && 'route' in plan ? plan.route : null
}

export type ProjectMapBatchOutcome<T> = { item: T; error?: string }

export type ProjectMapBatchSummary = {
  succeeded: number
  failed: number
  /** Each distinct reason once, with how many items it hit. */
  reasons: { reason: string; count: number }[]
}

export function summarizeProjectMapBatch(
  outcomes: readonly ProjectMapBatchOutcome<unknown>[]
): ProjectMapBatchSummary {
  const counts = new Map<string, number>()
  for (const outcome of outcomes) {
    if (outcome.error !== undefined) {
      counts.set(outcome.error, (counts.get(outcome.error) ?? 0) + 1)
    }
  }
  const failed = [...counts.values()].reduce((sum, count) => sum + count, 0)
  return {
    succeeded: outcomes.length - failed,
    failed,
    reasons: [...counts].map(([reason, count]) => ({ reason, count }))
  }
}

/** Runs each host's items one after another and the hosts side by side, so one slow or
 *  unreachable host does not hold up another; results come back in the items' order. */
export async function runProjectMapBatchByHost<T>(
  items: readonly T[],
  hostOf: (item: T) => string,
  run: (item: T) => Promise<void>
): Promise<ProjectMapBatchOutcome<T>[]> {
  const outcomes = new Map<T, ProjectMapBatchOutcome<T>>()
  const byHost = new Map<string, T[]>()
  for (const item of items) {
    const host = hostOf(item)
    byHost.set(host, [...(byHost.get(host) ?? []), item])
  }
  await Promise.all(
    [...byHost.values()].map(async (group) => {
      for (const item of group) {
        try {
          await run(item)
          outcomes.set(item, { item })
        } catch (error) {
          outcomes.set(item, {
            item,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }
    })
  )
  return items.map((item) => outcomes.get(item)!)
}
