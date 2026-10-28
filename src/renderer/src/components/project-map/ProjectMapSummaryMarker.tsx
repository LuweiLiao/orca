import { useSyncExternalStore } from 'react'
import { FileText } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import {
  projectMapSummaryState,
  subscribeToProjectMapSummaryState
} from './project-map-summary-state'

/** A small mark on a chat node that has a saved summary. */
export function ProjectMapSummaryMarker({
  sessionId
}: {
  sessionId: string | undefined
}): React.JSX.Element | null {
  const { summarized } = useSyncExternalStore(
    subscribeToProjectMapSummaryState,
    projectMapSummaryState
  )
  return sessionId && summarized.has(sessionId) ? (
    <FileText
      aria-label={translate('projectMap.summary.marker', 'Has a summary')}
      data-project-map-summary-marker=""
      className="size-3 shrink-0 text-muted-foreground"
    />
  ) : null
}
