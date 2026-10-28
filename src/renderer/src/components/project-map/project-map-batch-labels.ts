import { translate } from '@/i18n/i18n'
import type { ProjectMapBatchSkip, ProjectMapBatchSummary } from './project-map-batch-plan'

const SKIP_REASONS: Record<string, () => string> = {
  closed: () => translate('projectMap.batch.skip.closed', 'already closed'),
  'no-tab': () => translate('projectMap.batch.skip.noTab', 'no tab to close'),
  read: () => translate('projectMap.batch.skip.read', 'nothing unread'),
  'no-chat': () => translate('projectMap.batch.skip.noChat', 'not a structured chat'),
  'not-running': () => translate('projectMap.batch.skip.notRunning', 'not running'),
  'remote-host': () => translate('projectMap.batch.skip.remoteHost', 'on an SSH or WSL host'),
  'remote-worker': () => translate('projectMap.batch.skip.remoteWorker', 'a worker on another host')
}

/** The distinct reasons chats were left out, each with its count, as one phrase. */
export function projectMapBatchSkipText(skipped: readonly ProjectMapBatchSkip[]): string {
  const counts = new Map<string, number>()
  for (const { reason } of skipped) {
    counts.set(reason, (counts.get(reason) ?? 0) + 1)
  }
  return [...counts]
    .map(([reason, count]) => `${count} ${(SKIP_REASONS[reason] ?? (() => reason))()}`)
    .join(', ')
}

/** "2 succeeded, 1 failed", then why, for the one toast a partly failed batch ends in. */
export function projectMapBatchFailureText(summary: ProjectMapBatchSummary): string {
  return translate(
    'projectMap.batch.partial',
    '{{succeeded}} succeeded, {{failed}} failed: {{reasons}}',
    {
      succeeded: summary.succeeded,
      failed: summary.failed,
      reasons: summary.reasons
        .map(({ reason, count }) => (count > 1 ? `${reason} (×${count})` : reason))
        .join('; ')
    }
  )
}
