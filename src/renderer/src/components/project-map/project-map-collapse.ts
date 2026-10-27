import { dashboardCardDisplayState } from '../../../../shared/dashboard-snapshot'
import type {
  ProjectMapAgent,
  ProjectMapEdge,
  ProjectMapEdgeKind,
  ProjectMapGraph
} from './project-map-graph'

/** A parent delegating at least this many chats shows them as one stack until expanded. */
export const PROJECT_MAP_COLLAPSE_THRESHOLD = 4

export const PROJECT_MAP_GROUP_PREFIX = 'project-map-group:'

export type ProjectMapGroupCounts = { working: number; waiting: number; settled: number }

export type ProjectMapGroup = {
  id: string
  parentPaneKey: string
  /** Delegated children, in their delegation order. */
  childPaneKeys: string[]
  /** Children and everything they delegated, the whole stack. */
  memberPaneKeys: string[]
  counts: ProjectMapGroupCounts
}

export type ProjectMapCollapsedView = {
  /** What the layout draws: a stack replaces each collapsed parent's delegated chats. */
  graph: ProjectMapGraph
  groups: ReadonlyMap<string, ProjectMapGroup>
  /** The stack each hidden chat sits in, which anchors its window and its wires. */
  groupOf: ReadonlyMap<string, string>
  /** Parents that could collapse, collapsed or not. */
  collapsible: ReadonlySet<string>
}

const delegatedChildren = (agent: ProjectMapAgent, agents: ProjectMapGraph['agents']): string[] =>
  agent.childPaneKeys.filter((paneKey) => {
    const child = agents.get(paneKey)
    return child !== undefined && !child.fork
  })

/**
 * Folds each busy parent's delegated chats into one stack node. Forks are the person's own chats
 * and stay on the canvas; a wire into or out of a hidden chat attaches to its stack instead.
 * Status changes only move the stack's counts, so a running fleet never reflows the map.
 */
export function collapseProjectMapGraph(
  graph: ProjectMapGraph,
  expanded: ReadonlySet<string>
): ProjectMapCollapsedView {
  const groups = new Map<string, ProjectMapGroup>()
  const groupOf = new Map<string, string>()
  const collapsible = new Set<string>()
  const roots = [...graph.agents.values()].filter((agent) => !agent.parentPaneKey)
  const visit = (agent: ProjectMapAgent): void => {
    const children = delegatedChildren(agent, graph.agents)
    const paneKey = agent.card.paneKey
    if (children.length >= PROJECT_MAP_COLLAPSE_THRESHOLD) {
      collapsible.add(paneKey)
    }
    if (children.length >= PROJECT_MAP_COLLAPSE_THRESHOLD && !expanded.has(paneKey)) {
      const id = `${PROJECT_MAP_GROUP_PREFIX}${paneKey}`
      const members: string[] = []
      const gather = (memberKey: string): void => {
        const member = graph.agents.get(memberKey)
        if (!member || groupOf.has(memberKey)) {
          return
        }
        members.push(memberKey)
        groupOf.set(memberKey, id)
        for (const next of delegatedChildren(member, graph.agents)) {
          gather(next)
        }
      }
      children.forEach(gather)
      groups.set(id, {
        id,
        parentPaneKey: paneKey,
        childPaneKeys: children,
        memberPaneKeys: members,
        counts: countStates(members.map((memberKey) => graph.agents.get(memberKey)!))
      })
    }
    for (const childKey of agent.childPaneKeys) {
      const child = graph.agents.get(childKey)
      if (child && !groupOf.has(childKey)) {
        visit(child)
      }
    }
    // Forks out of a hidden chat stay visible; their own fleets may fold too.
    for (const memberKey of groups.get(`${PROJECT_MAP_GROUP_PREFIX}${paneKey}`)?.memberPaneKeys ??
      []) {
      for (const childKey of graph.agents.get(memberKey)?.childPaneKeys ?? []) {
        const child = graph.agents.get(childKey)
        if (child && !groupOf.has(childKey)) {
          visit(child)
        }
      }
    }
  }
  roots.forEach(visit)
  if (groups.size === 0) {
    return { graph, groups, groupOf, collapsible }
  }
  return { graph: projectedGraph(graph, groups, groupOf), groups, groupOf, collapsible }
}

function countStates(members: readonly ProjectMapAgent[]): ProjectMapGroupCounts {
  const counts = { working: 0, waiting: 0, settled: 0 }
  for (const member of members) {
    const state = dashboardCardDisplayState(member.card)
    if (state === 'working' || state === 'monitoring') {
      counts.working += 1
    } else if (state === 'waiting' || state === 'blocked') {
      counts.waiting += 1
    } else {
      counts.settled += 1
    }
  }
  return counts
}

function projectedGraph(
  graph: ProjectMapGraph,
  groups: ReadonlyMap<string, ProjectMapGroup>,
  groupOf: ReadonlyMap<string, string>
): ProjectMapGraph {
  const shown = (paneKey: string): string => groupOf.get(paneKey) ?? paneKey
  const agents = new Map<string, ProjectMapAgent>()
  for (const [paneKey, agent] of graph.agents) {
    if (groupOf.has(paneKey)) {
      continue
    }
    const stack = groups.get(`${PROJECT_MAP_GROUP_PREFIX}${paneKey}`)
    const childPaneKeys = [
      ...new Set(agent.childPaneKeys.map(shown).filter((key) => key !== paneKey))
    ]
    agents.set(paneKey, {
      ...agent,
      parentPaneKey: agent.parentPaneKey ? shown(agent.parentPaneKey) : null,
      childPaneKeys:
        stack && !childPaneKeys.includes(stack.id) ? [stack.id, ...childPaneKeys] : childPaneKeys
    })
  }
  for (const group of groups.values()) {
    const parent = graph.agents.get(group.parentPaneKey)!
    const outside = group.memberPaneKeys.flatMap((memberKey) =>
      (graph.agents.get(memberKey)?.childPaneKeys ?? []).filter((key) => !groupOf.has(key))
    )
    agents.set(group.id, {
      // Placed in the parent's lane like any child; the canvas draws it as a stack, not a chat.
      card: { ...parent.card, paneKey: group.id },
      parentPaneKey: group.parentPaneKey,
      hasUnresolvedParent: false,
      childPaneKeys: outside
    })
  }
  const edges: ProjectMapEdge[] = []
  const seen = new Set<string>()
  const push = (kind: ProjectMapEdgeKind, from: string, to: string): void => {
    const key = `${kind}|${from}|${to}`
    if (from !== to && !seen.has(key)) {
      seen.add(key)
      edges.push({ kind, from, to })
    }
  }
  for (const edge of graph.edges) {
    push(edge.kind, shown(edge.from), shown(edge.to))
  }
  // Stacks are reached through their parent; hidden chats are no lane's roots.
  const workspaces = new Map(
    [...graph.workspaces].map(([id, workspace]) => [
      id,
      {
        ...workspace,
        agentPaneKeys: workspace.agentPaneKeys.filter((paneKey) => !groupOf.has(paneKey))
      }
    ])
  )
  return { ...graph, workspaces, agents, edges }
}
