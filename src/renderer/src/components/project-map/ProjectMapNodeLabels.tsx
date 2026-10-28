import { Quote } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type { ProjectMapAgent } from './project-map-graph'
import type { ProjectMapNodeReferences } from './project-map-node-references'

export function forkChildCount(
  agent: ProjectMapAgent,
  agents: ReadonlyMap<string, ProjectMapAgent>
): number {
  return agent.childPaneKeys.filter((paneKey) => {
    const child = agents.get(paneKey)
    return child?.fork || child?.terminalFork
  }).length
}

export function forkSourceLabel(fork: NonNullable<ProjectMapAgent['fork']>): string {
  const values = {
    source: fork.sourceTitle ?? translate('projectMap.node.closedSource', 'a closed chat'),
    count: fork.messageCount
  }
  const handedOver = fork.entry.handedOverCount
  if (fork.sourceCount !== undefined && fork.sourceCount > 1) {
    return translate('projectMap.node.mergedFrom', 'Merged from {{source}} and {{others}} more', {
      ...values,
      others: fork.sourceCount - 1
    })
  }
  if (fork.mode === 'native') {
    return translate(
      'projectMap.node.forkedFrom',
      'Forked from {{source}} · {{count}} messages',
      values
    )
  }
  // The rest are linked from the hand-off, not pasted into it.
  return handedOver !== undefined && handedOver < fork.messageCount
    ? translate(
        'projectMap.node.handedOffPartly',
        'Handed off from {{source}} · latest {{handed}} of {{count}} messages',
        { ...values, handed: handedOver }
      )
    : translate(
        'projectMap.node.handedOffFrom',
        'Handed off from {{source}} · {{count}} messages',
        values
      )
}

/** How many conversations its messages referenced; the folded ones draw only while selected. */
export function ReferenceCount({
  references
}: {
  references: ProjectMapNodeReferences
}): React.JSX.Element {
  const label = [
    translate('projectMap.node.referenceCount', 'Referenced {{count}} conversations', {
      count: references.count
    }),
    references.folded > 0
      ? translate(
          'projectMap.node.referenceFolded',
          '{{count}} of them are elsewhere or to the right; select to see them',
          { count: references.folded }
        )
      : null
  ]
    .filter(Boolean)
    .join('\n')
  return (
    <span
      className="project-map-reference-count inline-flex shrink-0 items-center gap-0.5 text-[10.5px] tabular-nums"
      title={label}
      data-project-map-reference-count={references.count}
    >
      <Quote aria-hidden className="size-3" />
      {references.folded > 0 ? `↩${references.folded}/${references.count}` : references.count}
    </span>
  )
}
