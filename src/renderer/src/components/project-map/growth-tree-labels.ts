import { translate } from '@/i18n/i18n'
import type { DashboardBucket } from '../../../../shared/dashboard-snapshot'
import type { GrowthTimeWindow } from './growth-tree-focus'
import type { GrowthTreeLineKind } from './growth-tree-types'

export function growthBucketLabel(bucket: DashboardBucket): string {
  switch (bucket) {
    case 'working':
      return translate('growthTree.bucket.working', 'Working')
    case 'attention':
      return translate('growthTree.bucket.attention', 'Needs attention')
    case 'done':
      return translate('growthTree.bucket.done', 'Done')
    case 'idle':
      return translate('growthTree.bucket.idle', 'Idle')
  }
}

export function growthKindLabel(kind: GrowthTreeLineKind): string {
  switch (kind) {
    case 'derive':
      return translate('growthTree.kind.derive', 'Derived')
    case 'delegate':
      return translate('growthTree.kind.delegate', 'Delegated')
    case 'handoff':
      return translate('growthTree.kind.handoff', 'Handed off')
    case 'merge':
      return translate('growthTree.kind.merge', 'Merged')
    case 'reference':
      return translate('growthTree.kind.reference', 'Referenced')
  }
}

export function growthWindowLabel(window: GrowthTimeWindow): string {
  switch (window) {
    case 'all':
      return translate('growthTree.window.all', 'All time')
    case 'today':
      return translate('growthTree.window.today', 'Today')
    case '7d':
      return translate('growthTree.window.7d', 'Last 7 days')
    case '30d':
      return translate('growthTree.window.30d', 'Last 30 days')
  }
}

export function growthDateTime(time: number): string {
  return new Date(time).toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/** With seconds, for a playhead that moves within a minute. */
export function growthDateTimeSeconds(time: number): string {
  return new Date(time).toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}
