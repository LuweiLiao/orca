import type {
  AgentStatusOrchestrationContext,
  OrchestrationChatSession
} from '../../../../shared/agent-status-types'
import type {
  DashboardCard,
  DashboardSnapshot,
  DashboardWorkspace
} from '../../../../shared/dashboard-snapshot'
import type {
  AgentSessionForkMode,
  AgentSessionLineageEntry
} from '../../../../shared/agent-session-fork'
import type { AgentSessionReferenceLink } from '../../../../shared/agent-session-reference-link'
import type { ProjectMapChat, ProjectMapHistoryChat } from './project-map-lineage'
import { closedForkEnds, projectMapHistoryCard } from './project-map-closed-chats'
import { addReferenceEdges } from './project-map-reference-edges'

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
  /** The structured chat this card shows, from its tab or the published session. */
  chat?: ProjectMapChat
  /** Present only when the delegating or forked-from agent is in the same project. */
  parentPaneKey: string | null
  /** The card's delegator or fork source is known but outside this project or not loaded. */
  hasUnresolvedParent: boolean
  childPaneKeys: string[]
  /** A chat whose tab is closed, drawn because a fork or reference still connects it. */
  history?: true
  /** Conversations its sent messages referenced; `external` ones have no node on this map. */
  referencesIn?: { count: number; external: number }
  /** Set when this chat was forked from another; its parent above is that source. */
  fork?: {
    mode: AgentSessionForkMode
    messageCount: number
    sourceTitle: string | null
    entry: AgentSessionLineageEntry
  }
}

export type ProjectMapEdgeKind = 'derive' | 'delegate' | 'fork' | 'handoff' | 'reference'

export type ProjectMapEdge = {
  kind: ProjectMapEdgeKind
  from: string
  to: string
  /** References only: the newest one between these chats reads its source live. */
  live?: true
}

/** Forks the hosts recorded, and the chat behind each card, for drawing fork edges. */
export type ProjectMapForkInput = {
  chatsByPaneKey: ReadonlyMap<string, ProjectMapChat>
  lineage: ReadonlyMap<string, AgentSessionLineageEntry>
  /** Chats at fork and reference ends the hosts still record; closed ones become history nodes. */
  history?: ReadonlyMap<string, ProjectMapHistoryChat>
  /** References sent messages carried; drawn as wires that never change the layout's columns. */
  references?: readonly AgentSessionReferenceLink[]
  titleOf: (card: DashboardCard) => string
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
  sessionsByPaneKey: ReadonlyMap<string, OrchestrationChatSession> = new Map(),
  forks?: ProjectMapForkInput
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
    const chat = forks?.chatsByPaneKey.get(listed.paneKey)
    agents.set(card.paneKey, {
      card,
      ...(session ? { session } : {}),
      ...(chat ? { chat } : {}),
      parentPaneKey: null,
      hasUnresolvedParent: false,
      childPaneKeys: []
    })
    workspace.agentPaneKeys.push(card.paneKey)
  }
  // One chat open in two panes (a split) wires its forks to the pane that opened it first.
  const paneKeyBySession = new Map<string, string>()
  for (const agent of agents.values()) {
    if (agent.chat && !paneKeyBySession.has(agent.chat.sessionId)) {
      paneKeyBySession.set(agent.chat.sessionId, agent.card.paneKey)
    }
  }
  for (const chat of forks ? closedForkEnds(forks, paneKeyBySession) : []) {
    const workspace = workspaces.get(chat.workspaceId)
    if (!workspace) {
      continue
    }
    const card = projectMapHistoryCard(chat, workspace)
    agents.set(card.paneKey, {
      card,
      chat: { sessionId: chat.sessionId, agent: chat.agent, executionHostId: chat.executionHostId },
      parentPaneKey: null,
      hasUnresolvedParent: false,
      childPaneKeys: [],
      history: true
    })
    workspace.agentPaneKeys.push(card.paneKey)
    paneKeyBySession.set(chat.sessionId, card.paneKey)
  }
  for (const agent of agents.values()) {
    const entry = agent.chat ? forks?.lineage.get(agent.chat.sessionId) : undefined
    // A fork is the person's own chat, never a worker, so its source is its only parent.
    const parentKey = entry
      ? (paneKeyBySession.get(entry.sourceSessionId) ?? null)
      : (agent.card.parentPaneKey ?? null)
    if (entry) {
      const source = parentKey ? agents.get(parentKey) : undefined
      agent.fork = {
        mode: entry.mode,
        messageCount: entry.cut.messageCount,
        sourceTitle: source && forks ? forks.titleOf(source.card) : null,
        entry
      }
    }
    if (!parentKey || parentKey === agent.card.paneKey) {
      agent.hasUnresolvedParent = Boolean(entry)
      continue
    }
    const parent = agents.get(parentKey)
    if (!parent || createsDelegationCycle(agents, parentKey, agent.card.paneKey)) {
      agent.hasUnresolvedParent = !parent
      continue
    }
    agent.parentPaneKey = parentKey
    parent.childPaneKeys.push(agent.card.paneKey)
    edges.push({
      kind: entry ? (entry.mode === 'native' ? 'fork' : 'handoff') : 'delegate',
      from: parentKey,
      to: agent.card.paneKey
    })
  }
  if (forks?.references) {
    addReferenceEdges(forks.references, agents, paneKeyBySession, edges)
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
