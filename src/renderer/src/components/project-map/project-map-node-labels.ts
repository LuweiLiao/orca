import { translate } from '@/i18n/i18n'
import type { ProjectMapAgent } from './project-map-graph'

export function forkChildCount(
  agent: ProjectMapAgent,
  agents: ReadonlyMap<string, ProjectMapAgent>
): number {
  return agent.childPaneKeys.filter((paneKey) => agents.get(paneKey)?.fork).length
}

export function forkSourceLabel(fork: NonNullable<ProjectMapAgent['fork']>): string {
  return translate('projectMap.node.forkedFrom', 'Forked from {{source}}', {
    source: fork.sourceTitle ?? translate('projectMap.node.closedSource', 'a closed chat')
  })
}
