import { dashboardCardDisplayState } from '../../../../shared/dashboard-snapshot'
import type { ProjectMapGraph } from './project-map-graph'
import { projectMapAgentTitle, projectMapStateLabel } from './project-map-labels'

export type ProjectMapSearchHit = {
  /** The node to show: a workspace's id or a chat's pane key. */
  id: string
  kind: 'workspace' | 'agent'
  title: string
  /** What else matched or locates it: the workspace of a chat, the branch of a workspace. */
  detail: string
  /** The chat is closed and drawn only because a fork still joins it. */
  closed: boolean
}

const MAX_HITS = 40

type Candidate = ProjectMapSearchHit & { fields: string[] }

function candidates(
  graph: ProjectMapGraph,
  branchOf: (worktreeId: string) => string | null
): Candidate[] {
  const workspaces = [...graph.workspaces.values()].map<Candidate>((workspace) => {
    const branch = branchOf(workspace.worktreeId)
    return {
      id: workspace.worktreeId,
      kind: 'workspace',
      title: workspace.worktreeName,
      detail: branch ?? '',
      closed: false,
      fields: [workspace.worktreeName, branch ?? '']
    }
  })
  const agents = [...graph.agents.values()].map<Candidate>((agent) => {
    const { card } = agent
    const title = projectMapAgentTitle(card)
    return {
      id: card.paneKey,
      kind: 'agent',
      title,
      detail: card.worktreeName,
      closed: agent.history === true,
      fields: [
        title,
        card.task,
        card.worktreeName,
        branchOf(card.worktreeId) ?? '',
        agent.history ? '' : projectMapStateLabel(dashboardCardDisplayState(card))
      ]
    }
  })
  return [...agents, ...workspaces]
}

/** Every word must appear somewhere in a node's title, task, workspace, branch or state. */
export function searchProjectMap(
  graph: ProjectMapGraph,
  query: string,
  branchOf: (worktreeId: string) => string | null
): ProjectMapSearchHit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) {
    return []
  }
  const ranked: { hit: ProjectMapSearchHit; rank: number }[] = []
  for (const { fields, ...hit } of candidates(graph, branchOf)) {
    const haystack = fields.map((field) => field.toLowerCase())
    if (!words.every((word) => haystack.some((field) => field.includes(word)))) {
      continue
    }
    // A title hit outranks one found only in the task, branch or state.
    ranked.push({
      hit,
      rank: words.every((word) => haystack[0].includes(word)) ? 0 : 1
    })
  }
  return ranked
    .sort((a, b) => a.rank - b.rank || a.hit.title.localeCompare(b.hit.title))
    .slice(0, MAX_HITS)
    .map(({ hit }) => hit)
}
