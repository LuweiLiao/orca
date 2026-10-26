import type {
  AgentStatusOrchestrationContext,
  OrchestrationChatSession
} from '../../../../shared/agent-status-types'
import type {
  DashboardCard,
  DashboardSnapshot,
  DashboardWorkspace
} from '../../../../shared/dashboard-snapshot'

export type ProjectMapProject = {
  id: string
  name: string
  workspaceCount: number
  agentCount: number
}

export type ProjectMapWorkspace = DashboardWorkspace & {
  /** Present only when the parent workspace is in the same project. */
  parentId: string | null
  childIds: string[]
  agentPaneKeys: string[]
}

export type ProjectMapAgent = {
  card: DashboardCard
  /** The structured chat behind the card, when the runtime published it. */
  session?: OrchestrationChatSession
  /** Present only when the delegating agent is in the same project. */
  parentPaneKey: string | null
  /** The card's delegator is known but outside this project or not loaded. */
  hasUnresolvedParent: boolean
  childPaneKeys: string[]
}

export type ProjectMapEdge = {
  kind: 'derive' | 'delegate'
  from: string
  to: string
}

export type ProjectMapGraph = {
  projectId: string
  workspaces: Map<string, ProjectMapWorkspace>
  agents: Map<string, ProjectMapAgent>
  edges: ProjectMapEdge[]
}

export function listProjectMapProjects(snapshot: DashboardSnapshot): ProjectMapProject[] {
  const projects = new Map<string, ProjectMapProject>()
  for (const workspace of snapshot.workspaces ?? []) {
    const project = projects.get(workspace.repoId) ?? {
      id: workspace.repoId,
      name: workspace.repoName,
      workspaceCount: 0,
      agentCount: 0
    }
    project.workspaceCount += 1
    projects.set(workspace.repoId, project)
  }
  for (const card of snapshot.cards) {
    const project = projects.get(card.repoId)
    if (project) {
      project.agentCount += 1
    }
  }
  return [...projects.values()]
}

const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name)

/**
 * One project's workspaces and agents with derive/delegate edges; edges never leave the project.
 * `sessionsByPaneKey` names the workspace a chat really lives in: the sidebar also lists a
 * worker under its coordinator's workspace and the coordinator under each worker's, and the map
 * must draw each chat once.
 */
export function buildProjectMapGraph(
  snapshot: DashboardSnapshot,
  projectId: string,
  sessionsByPaneKey: ReadonlyMap<string, OrchestrationChatSession> = new Map()
): ProjectMapGraph {
  const workspaces = new Map<string, ProjectMapWorkspace>()
  for (const workspace of snapshot.workspaces ?? []) {
    if (workspace.repoId === projectId) {
      workspaces.set(workspace.worktreeId, {
        ...workspace,
        parentId: null,
        childIds: [],
        agentPaneKeys: []
      })
    }
  }
  const edges: ProjectMapEdge[] = []
  const sortedWorkspaces = [...workspaces.values()].sort((a, b) =>
    byName({ name: a.worktreeName }, { name: b.worktreeName })
  )
  for (const workspace of sortedWorkspaces) {
    const parent = workspace.parentWorktreeId ? workspaces.get(workspace.parentWorktreeId) : null
    if (parent && parent !== workspace) {
      workspace.parentId = parent.worktreeId
      parent.childIds.push(workspace.worktreeId)
      edges.push({ kind: 'derive', from: parent.worktreeId, to: workspace.worktreeId })
    }
  }

  const agents = new Map<string, ProjectMapAgent>()
  const cards = [...snapshot.cards].sort((a, b) => a.startedAt - b.startedAt)
  const cardByPaneKey = new Map<string, DashboardCard>()
  for (const card of cards) {
    if (card.repoId !== projectId || !workspaces.has(card.worktreeId)) {
      continue
    }
    const current = cardByPaneKey.get(card.paneKey)
    const owner = sessionsByPaneKey.get(card.paneKey)?.worktreeId
    if (!current || (owner === card.worktreeId && current.worktreeId !== owner)) {
      cardByPaneKey.set(card.paneKey, card)
    }
  }
  for (const listed of cardByPaneKey.values()) {
    const session = sessionsByPaneKey.get(listed.paneKey)
    // Why: once a worker's own tab closes, only its coordinator's workspace still lists it.
    const home = session ? workspaces.get(session.worktreeId) : undefined
    const workspace = home ?? workspaces.get(listed.worktreeId)
    if (!workspace) {
      continue
    }
    const card =
      workspace.worktreeId === listed.worktreeId
        ? listed
        : { ...listed, worktreeId: workspace.worktreeId, worktreeName: workspace.worktreeName }
    agents.set(card.paneKey, {
      card,
      ...(session ? { session } : {}),
      parentPaneKey: null,
      hasUnresolvedParent: false,
      childPaneKeys: []
    })
    workspace.agentPaneKeys.push(card.paneKey)
  }
  for (const agent of agents.values()) {
    const parentKey = agent.card.parentPaneKey
    if (!parentKey || parentKey === agent.card.paneKey) {
      continue
    }
    const parent = agents.get(parentKey)
    if (!parent || createsDelegationCycle(agents, parentKey, agent.card.paneKey)) {
      agent.hasUnresolvedParent = !parent
      continue
    }
    agent.parentPaneKey = parentKey
    parent.childPaneKeys.push(agent.card.paneKey)
    edges.push({ kind: 'delegate', from: parentKey, to: agent.card.paneKey })
  }
  return { projectId, workspaces, agents, edges }
}

// Why: parentPaneKey comes from live status rows, so a stale pair can name each other.
function createsDelegationCycle(
  agents: Map<string, ProjectMapAgent>,
  parentKey: string,
  childKey: string
): boolean {
  const seen = new Set<string>()
  let cursor: string | null = parentKey
  while (cursor) {
    if (cursor === childKey || seen.has(cursor)) {
      return true
    }
    seen.add(cursor)
    cursor = agents.get(cursor)?.parentPaneKey ?? null
  }
  return false
}

/** The structured chat behind each orchestrated pane, read from the sessions the runtime published. */
export function projectMapChatSessions(
  contexts: Readonly<Record<string, AgentStatusOrchestrationContext>> | undefined
): Map<string, OrchestrationChatSession> {
  const sessions = new Map<string, OrchestrationChatSession>()
  for (const [paneKey, context] of Object.entries(contexts ?? {})) {
    if (context.session) {
      sessions.set(paneKey, context.session)
    }
  }
  for (const context of Object.values(contexts ?? {})) {
    if (context.parentPaneKey && context.parentSession && !sessions.has(context.parentPaneKey)) {
      sessions.set(context.parentPaneKey, context.parentSession)
    }
  }
  return sessions
}
