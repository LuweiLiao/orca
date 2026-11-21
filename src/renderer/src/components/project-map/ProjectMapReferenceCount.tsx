import { Quote } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type { ProjectMapNodeReferences } from './project-map-node-references'

/** How many conversations its messages referenced; the folded ones draw only while selected. */
export function ProjectMapReferenceCount({
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
