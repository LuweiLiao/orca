import React from 'react'
import { AlertCircle, GitBranch, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { GitGraphScope } from '../../../../shared/git-graph-types'
import type { GitGraphOwner } from './git-graph-owner'
import type { GitGraphHistoryState } from './use-git-graph-history'
import { gitGraphScopeLabel } from './git-graph-toolbar'

function PanelMessage({
  icon,
  tone = 'muted',
  children,
  action
}: {
  icon: React.ReactNode
  tone?: 'muted' | 'destructive'
  children: React.ReactNode
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-xs',
        tone === 'destructive' ? 'text-destructive' : 'text-muted-foreground'
      )}
    >
      {icon}
      <div role={tone === 'destructive' ? 'alert' : 'status'} className="max-w-md break-words">
        {children}
      </div>
      {action}
    </div>
  )
}

function NotGitMessage(): React.JSX.Element {
  return (
    <PanelMessage icon={<GitBranch className="size-5" />}>
      {translate(
        'auto.components.gitGraph.panel.notGit',
        'Git Graph is unavailable because this workspace folder is not a Git repository.'
      )}
    </PanelMessage>
  )
}

export function GitGraphOwnerMessage({
  owner
}: {
  owner: GitGraphOwner
}): React.JSX.Element | null {
  if (owner.status === 'not-git') {
    return <NotGitMessage />
  }
  if (owner.status === 'unavailable') {
    return (
      <PanelMessage icon={<AlertCircle className="size-5" />} tone="destructive">
        {owner.message}
      </PanelMessage>
    )
  }
  return null
}

/** Full-panel state shown instead of the commit list, or null when rows can render. */
export function renderGitGraphHistoryMessage({
  state,
  awaitingRef,
  onRetry
}: {
  state: GitGraphHistoryState
  awaitingRef: boolean
  onRetry: () => void
}): React.JSX.Element | null {
  if (state.status === 'unsupported') {
    return (
      <PanelMessage icon={<AlertCircle className="size-5" />}>
        {translate(
          'auto.components.gitGraph.panel.unsupported',
          'The Orca runtime that owns this workspace is too old for Git Graph. Update it to browse the graph.'
        )}
      </PanelMessage>
    )
  }
  if (state.status === 'not-git') {
    return <NotGitMessage />
  }
  if (state.status === 'error' && !state.result) {
    return (
      <PanelMessage
        icon={<AlertCircle className="size-5" />}
        tone="destructive"
        action={
          <Button type="button" variant="outline" size="xs" onClick={onRetry}>
            {translate('auto.components.gitGraph.list.retry', 'Retry')}
          </Button>
        }
      >
        {state.error}
      </PanelMessage>
    )
  }
  if (awaitingRef) {
    return (
      <PanelMessage icon={<GitBranch className="size-5" />}>
        {translate(
          'auto.components.gitGraph.panel.chooseRef',
          'Choose a branch or tag to show its history.'
        )}
      </PanelMessage>
    )
  }
  if (!state.result) {
    return (
      <PanelMessage icon={<Loader2 className="size-5 animate-spin" />}>
        {translate('auto.components.gitGraph.panel.loading', 'Loading commits…')}
      </PanelMessage>
    )
  }
  if (state.result.items.length === 0) {
    return (
      <PanelMessage icon={<GitBranch className="size-5" />}>
        {translate('auto.components.gitGraph.panel.empty', 'No commits yet')}
      </PanelMessage>
    )
  }
  return null
}

export function GitGraphStatusBar({
  state,
  scope,
  refName
}: {
  state: GitGraphHistoryState
  scope: GitGraphScope
  refName?: string
}): React.JSX.Element | null {
  const result = state.result
  if (!result) {
    return null
  }
  const scopeLabel = scope === 'ref' && refName ? refName : gitGraphScopeLabel(scope)
  const parts = [
    result.hasMore
      ? translate(
          'auto.components.gitGraph.status.loadedPartial',
          '{{value0}} commits loaded from {{value1}}; scroll to load more',
          { value0: result.items.length, value1: scopeLabel }
        )
      : translate('auto.components.gitGraph.status.loadedAll', '{{value0}} commits in {{value1}}', {
          value0: result.items.length,
          value1: scopeLabel
        })
  ]
  if (result.truncated) {
    parts.push(
      translate(
        'auto.components.gitGraph.status.truncated',
        'Partial graph: some refs or older commits were omitted'
      )
    )
  }
  if (result.isShallow) {
    parts.push(
      translate(
        'auto.components.gitGraph.status.shallow',
        'Shallow clone: history stops at the shallow boundary'
      )
    )
  }
  return (
    <div
      role="status"
      className="flex h-6 shrink-0 items-center gap-2 border-t border-border px-3 text-2xs text-muted-foreground"
    >
      <span className="min-w-0 truncate">{parts.join(' · ')}</span>
      {state.error && (
        <span className="ml-auto min-w-0 shrink truncate text-destructive">
          {translate(
            'auto.components.gitGraph.status.refreshFailed',
            'Refresh failed: {{value0}}',
            {
              value0: state.error
            }
          )}
        </span>
      )}
    </div>
  )
}
