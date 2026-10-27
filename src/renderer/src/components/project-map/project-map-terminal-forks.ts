import type { TerminalForkOrigin } from '@/lib/terminal-fork-origins'
import type { ProjectMapAgent, ProjectMapEdge } from './project-map-graph'

/**
 * Draws each terminal "Fork Agent Session…" from the pane it was taken from to the agent it
 * launched: a hand-off, since the agent got scrollback as text. Only forks this desktop made are
 * known; the fork workspace is nested under its source either way, so other clients still see it.
 */
export function addTerminalForkEdges(
  origins: readonly TerminalForkOrigin[],
  agents: Map<string, ProjectMapAgent>,
  edges: ProjectMapEdge[],
  createsCycle: (parentKey: string, childKey: string) => boolean,
  titleOf: (agent: ProjectMapAgent) => string
): void {
  for (const origin of origins) {
    const source = agents.get(origin.sourcePaneKey)
    const child = [...agents.values()].find(
      (agent) =>
        agent.card.worktreeId === origin.forkWorktreeId &&
        !agent.parentPaneKey &&
        (origin.childTabId === null || agent.card.tabId === origin.childTabId)
    )
    if (!source || !child || createsCycle(source.card.paneKey, child.card.paneKey)) {
      continue
    }
    child.parentPaneKey = source.card.paneKey
    child.hasUnresolvedParent = false
    child.terminalFork = { sourceTitle: titleOf(source) }
    source.childPaneKeys.push(child.card.paneKey)
    edges.push({ kind: 'handoff', from: source.card.paneKey, to: child.card.paneKey })
  }
}
