import React from 'react'
import { Copy, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import type { GitHistoryItem } from '../../../../shared/git-history-types'
import type { GitBranchChangeEntry } from '../../../../shared/git-diff-compare-types'
import { dedupeRemoteTrackingRefs } from '../../../../shared/git-history-ref-display'
import {
  GitHistoryCommitFiles,
  type GitHistoryCommitFilesState
} from '../right-sidebar/source-control/sync/git-history-commit-files'
import { formatGitHistoryTimestamp } from '../right-sidebar/source-control/sync/git-history-format'
import type { SourceControlRowOpenEvent } from '../right-sidebar/source-control/listing/split-open'
import { getGitGraphCommitBody } from './git-graph-model'
import { GitGraphRefBadge } from './git-graph-row'

function IconAction({
  label,
  onClick,
  children
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon-xs" aria-label={label} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

export function GitGraphCommitDetail({
  item,
  filesState,
  isCommitLoaded,
  onSelectCommit,
  onRetryFiles,
  onOpenFile,
  onOpenAll,
  onCopyHash,
  onClose
}: {
  item: GitHistoryItem
  filesState: GitHistoryCommitFilesState | null
  isCommitLoaded: (id: string) => boolean
  onSelectCommit: (id: string) => void
  onRetryFiles: () => void
  onOpenFile: (entry: GitBranchChangeEntry, event: SourceControlRowOpenEvent) => void
  onOpenAll: () => void
  onCopyHash: () => void
  onClose: () => void
}): React.JSX.Element {
  const body = getGitGraphCommitBody(item)
  const refs = dedupeRemoteTrackingRefs(item.references ?? [])
  const date = formatGitHistoryTimestamp(item.timestamp)

  return (
    <section
      aria-label={translate('auto.components.gitGraph.detail.label', 'Commit details')}
      className="flex min-h-0 min-w-0 flex-col bg-background"
      data-testid="git-graph-commit-detail"
    >
      <header className="flex shrink-0 items-start gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium break-words text-foreground">{item.subject}</h2>
          {refs.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {refs.map((ref) => (
                <GitGraphRefBadge key={ref.id} itemRef={ref} />
              ))}
            </div>
          )}
        </div>
        <IconAction
          label={translate('auto.components.gitGraph.detail.close', 'Close commit details')}
          onClick={onClose}
        >
          <X />
        </IconAction>
      </header>
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-auto">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1 px-3 py-2 text-xs">
          <dt className="text-muted-foreground">
            {translate('auto.components.gitGraph.detail.author', 'Author')}
          </dt>
          <dd className="min-w-0 break-words">
            {item.author}
            {item.authorEmail && (
              <span className="ml-1 text-muted-foreground">{`<${item.authorEmail}>`}</span>
            )}
          </dd>
          {date && (
            <>
              <dt className="text-muted-foreground">
                {translate('auto.components.gitGraph.detail.date', 'Date')}
              </dt>
              <dd className="min-w-0">{date}</dd>
            </>
          )}
          <dt className="text-muted-foreground">
            {translate('auto.components.gitGraph.detail.commit', 'Commit')}
          </dt>
          <dd className="flex min-w-0 items-center gap-1">
            <span className="min-w-0 truncate font-mono select-text">{item.id}</span>
            <IconAction
              label={translate('auto.components.gitGraph.detail.copyHash', 'Copy commit hash')}
              onClick={onCopyHash}
            >
              <Copy />
            </IconAction>
          </dd>
          <dt className="text-muted-foreground">
            {translate('auto.components.gitGraph.detail.parents', 'Parents')}
          </dt>
          <dd className="flex min-w-0 flex-wrap gap-x-2 gap-y-0.5 font-mono">
            {item.parentIds.length === 0 && (
              <span className="font-sans text-muted-foreground">
                {translate('auto.components.gitGraph.detail.rootCommit', 'None (root commit)')}
              </span>
            )}
            {item.parentIds.map((parentId) =>
              isCommitLoaded(parentId) ? (
                <button
                  key={parentId}
                  type="button"
                  className="cursor-pointer rounded-sm text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-1 focus-visible:ring-ring"
                  aria-label={translate(
                    'auto.components.gitGraph.detail.selectParent',
                    'Select parent commit {{value0}}',
                    { value0: parentId.slice(0, 8) }
                  )}
                  onClick={() => onSelectCommit(parentId)}
                >
                  {parentId.slice(0, 8)}
                </button>
              ) : (
                <span key={parentId} className="text-muted-foreground">
                  {parentId.slice(0, 8)}
                </span>
              )
            )}
          </dd>
        </dl>
        {body && (
          <div className="border-t border-border px-3 py-2 text-xs break-words whitespace-pre-wrap select-text">
            {body}
          </div>
        )}
        <div className="border-t border-border pt-1 pb-2">
          <div className="px-3 py-1 text-2xs font-semibold tracking-wide text-muted-foreground uppercase">
            {translate('auto.components.gitGraph.detail.files', 'Changed files')}
          </div>
          <GitHistoryCommitFiles
            state={filesState ?? { status: 'loading' }}
            onOpenFile={onOpenFile}
            onOpenAll={onOpenAll}
          />
          {filesState?.status === 'error' && (
            <Button type="button" variant="ghost" size="xs" className="ml-7" onClick={onRetryFiles}>
              {translate('auto.components.gitGraph.list.retry', 'Retry')}
            </Button>
          )}
        </div>
      </div>
    </section>
  )
}
