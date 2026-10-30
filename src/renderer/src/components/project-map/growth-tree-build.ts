import type { OrchestrationChatSession } from '../../../../shared/agent-status-types'
import {
  dashboardCardDisplayState,
  type DashboardSnapshot
} from '../../../../shared/dashboard-snapshot'
import { agentSessionLineageSources } from '../../../../shared/agent-session-fork'
import {
  buildProjectMapGraph,
  type ProjectMapAgent,
  type ProjectMapForkInput,
  type ProjectMapGraph
} from './project-map-graph'
import { projectMapHideKey } from './project-map-hidden-filter'
import { clampRelationTime, resolveGrowthStarts, type GrowthTimedBar } from './growth-tree-times'
import { buildGrowthLanes } from './growth-tree-lanes'
import type {
  GrowthTree,
  GrowthTreeBar,
  GrowthTreeCrossLink,
  GrowthTreeEdge,
  GrowthTreeEdgeKind,
  GrowthTreeReference
} from './growth-tree-types'

export type GrowthTreeInput = {
  snapshot: DashboardSnapshot
  projects: readonly { id: string; name: string }[]
  sessions: ReadonlyMap<string, OrchestrationChatSession>
  /** Hidden chats stay on the tree and are only flagged. */
  forks: ProjectMapForkInput
  now: number
}

type Draft = { agent: ProjectMapAgent; projectId: string; laneId: string }
type Relation = {
  kind: Exclude<GrowthTreeEdgeKind, 'derive'>
  from: string
  to: string
  entryAt: number | null
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Every project's blueprint graph on one time axis. A chat the sidebar lists under a coordinator's
 * workspace in another project belongs to the project its own session lives in.
 */
export function buildGrowthTree(input: GrowthTreeInput): GrowthTree {
  const { snapshot, projects, sessions, forks, now } = input
  const { hidden, ...forkInput } = forks
  const ordered = [...projects].sort((a, b) => cmp(a.id, b.id))
  const graphs = ordered.map((project) =>
    buildProjectMapGraph(snapshot, project.id, sessions, forkInput)
  )
  const owners = paneOwners(graphs, sessions)
  const drafts = new Map<string, Draft>()
  for (const graph of graphs) {
    for (const [paneKey, agent] of graph.agents) {
      if (owners.get(paneKey) === graph.projectId) {
        drafts.set(paneKey, { agent, projectId: graph.projectId, laneId: agent.card.worktreeId })
      }
    }
  }
  const barBySession = new Map<string, string>()
  for (const [id, draft] of drafts) {
    const sessionId = draft.agent.chat?.sessionId
    if (sessionId && !barBySession.has(sessionId)) {
      barBySession.set(sessionId, id)
    }
  }
  const relations = collectRelations(graphs, owners, drafts, barBySession)
  const timed: GrowthTimedBar[] = [...drafts].map(([id, draft]) => ({
    id,
    laneId: draft.laneId,
    projectId: draft.projectId,
    startedAt: draft.agent.card.startedAt,
    forkedAt: draft.agent.fork?.entry.createdAt ?? null
  }))
  const starts = resolveGrowthStarts(timed, relations, now)
  const startOf = (id: string): number => starts.get(id)?.start ?? now

  const edges: GrowthTreeEdge[] = []
  const crossLinks: GrowthTreeCrossLink[] = []
  const lastOutgoing = new Map<string, number>()
  const hasSource = new Set<string>()
  for (const relation of relations) {
    const from = drafts.get(relation.from)!
    const to = drafts.get(relation.to)!
    const toStart = startOf(relation.to)
    const at =
      relation.kind === 'delegate'
        ? toStart
        : clampRelationTime(relation.entryAt ?? toStart, startOf(relation.from), toStart)
    const id = `${relation.kind}:${relation.from}>${relation.to}`
    lastOutgoing.set(relation.from, Math.max(lastOutgoing.get(relation.from) ?? 0, at))
    if (from.projectId === to.projectId) {
      edges.push({
        id,
        kind: relation.kind,
        from: relation.from,
        to: relation.to,
        projectId: to.projectId,
        at
      })
    } else {
      hasSource.add(relation.to)
      crossLinks.push({
        id,
        kind: relation.kind,
        from: relation.from,
        to: relation.to,
        fromProjectId: from.projectId,
        toProjectId: to.projectId,
        at
      })
    }
  }

  const bars = new Map<string, GrowthTreeBar>()
  for (const [id, draft] of [...drafts].sort(([a], [b]) => cmp(a, b))) {
    const { card } = draft.agent
    const history = draft.agent.history === true
    const start = startOf(id)
    const running =
      !history &&
      (card.finishedAt === null || card.bucket === 'working' || card.bucket === 'attention')
    const finished = Math.max(
      start,
      history ? (lastOutgoing.get(id) ?? 0) : (card.finishedAt ?? card.stateChangedAt)
    )
    bars.set(id, {
      id,
      projectId: draft.projectId,
      workspaceId: draft.laneId,
      title: forks.titleOf(card),
      agentType: card.agentType,
      state: history ? 'idle' : dashboardCardDisplayState(card),
      bucket: card.bucket,
      sessionId: draft.agent.chat?.sessionId ?? null,
      start,
      end: running ? Math.max(start, now) : Math.min(Math.max(start, now), finished),
      running,
      startApprox: starts.get(id)?.approx ?? false,
      history,
      hiddenInBlueprint: hidden?.has(projectMapHideKey(draft.agent)) === true,
      unresolvedSource: draft.agent.hasUnresolvedParent && !hasSource.has(id),
      agent: draft.agent
    })
  }
  const { lanes, projects: groups, deriveEdges } = buildGrowthLanes(graphs, ordered, bars, now)
  edges.push(...deriveEdges)
  edges.sort((a, b) => cmp(a.id, b.id))
  crossLinks.sort((a, b) => cmp(a.id, b.id))
  const references = buildGrowthReferences(forks.references ?? [], barBySession, bars)
  return { now, projects: groups, lanes, bars, edges, crossLinks, references }
}

/** One pointer per carrier and referenced chat; the newest decides whether it reads live. */
function buildGrowthReferences(
  links: NonNullable<ProjectMapForkInput['references']>,
  barBySession: ReadonlyMap<string, string>,
  bars: ReadonlyMap<string, GrowthTreeBar>
): GrowthTreeReference[] {
  const found = new Map<string, GrowthTreeReference>()
  for (const link of [...links].sort((a, b) => a.createdAt - b.createdAt)) {
    const from = barBySession.get(link.targetSessionId)
    const to = link.source ? barBySession.get(link.source.sessionId) : undefined
    const carrier = from ? bars.get(from) : undefined
    const referenced = to ? bars.get(to) : undefined
    if (!from || !to || from === to || !carrier || !referenced) {
      continue
    }
    if (carrier.projectId !== referenced.projectId) {
      continue
    }
    const id = `reference:${from}>${to}`
    const earlier = found.get(id)
    found.set(id, {
      id,
      kind: 'reference',
      from,
      to,
      projectId: carrier.projectId,
      at: earlier?.at ?? Math.min(carrier.end, Math.max(carrier.start, link.createdAt)),
      live: link.sourceMessageCount === null
    })
  }
  return [...found.values()].sort((a, b) => cmp(a.id, b.id))
}

/** The project each pane belongs to: where its own session lives, else the first that lists it. */
function paneOwners(
  graphs: readonly ProjectMapGraph[],
  sessions: ReadonlyMap<string, OrchestrationChatSession>
): Map<string, string> {
  const owners = new Map<string, string>()
  for (const graph of graphs) {
    for (const paneKey of graph.agents.keys()) {
      if (!owners.has(paneKey)) {
        owners.set(paneKey, graph.projectId)
      }
    }
  }
  for (const graph of graphs) {
    for (const paneKey of graph.agents.keys()) {
      const home = sessions.get(paneKey)?.worktreeId
      if (home !== undefined && graph.workspaces.has(home)) {
        owners.set(paneKey, graph.projectId)
      }
    }
  }
  return owners
}

/** Delegations, hand-offs and merge sources between drafts, inside one project or across two. */
function collectRelations(
  graphs: readonly ProjectMapGraph[],
  owners: ReadonlyMap<string, string>,
  drafts: ReadonlyMap<string, Draft>,
  barBySession: ReadonlyMap<string, string>
): Relation[] {
  const found = new Map<string, Relation>()
  const add = (kind: Relation['kind'], from: string | undefined, to: string): void => {
    if (from && from !== to && drafts.has(from) && drafts.has(to)) {
      const entryAt =
        kind === 'delegate' ? null : (drafts.get(to)!.agent.fork?.entry.createdAt ?? null)
      found.set(`${kind}:${from}>${to}`, { kind, from, to, entryAt })
    }
  }
  for (const graph of graphs) {
    for (const edge of graph.edges) {
      if (
        (edge.kind === 'delegate' || edge.kind === 'handoff' || edge.kind === 'merge') &&
        owners.get(edge.to) === graph.projectId
      ) {
        add(edge.kind, edge.from, edge.to)
      }
    }
  }
  for (const [id, draft] of drafts) {
    const entry = draft.agent.fork?.entry
    if (!entry) {
      add('delegate', draft.agent.card.parentPaneKey, id)
      continue
    }
    agentSessionLineageSources(entry).forEach((source, index) => {
      add(index === 0 ? 'handoff' : 'merge', barBySession.get(source.sessionId), id)
    })
  }
  return [...found.values()].sort((a, b) =>
    cmp(`${a.kind}:${a.from}>${a.to}`, `${b.kind}:${b.from}>${b.to}`)
  )
}
