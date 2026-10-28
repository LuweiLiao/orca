import { useMemo, useState } from 'react'
import { FileText, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import { structuredAgentSessionTargetForHost } from '@/runtime/structured-agent-session-owner'
import type { ProjectMapAgent } from './project-map-graph'
import { projectMapAgentTitle } from './project-map-labels'
import { useProjectMapSummary } from './use-project-map-summary'

type Props = {
  agent: ProjectMapAgent
  onClose: () => void
}

/** A chat's summary beside the map: make it on request, edit it, keep it. */
export function ProjectMapSummaryPanel({ agent, onClose }: Props): React.JSX.Element {
  const sessionId = agent.chat?.sessionId ?? null
  const hostId = agent.chat?.executionHostId
  // Stable across renders: the summary hook re-reads, and cancels a running request, when it changes.
  const target = useMemo(() => structuredAgentSessionTargetForHost(hostId), [hostId])
  const summary = useProjectMapSummary(target, sessionId)
  const saved = summary.state.summary?.text ?? ''
  // An edit belongs to the saved text it started from; a new saved text (generated or loaded) wins.
  const [edit, setEdit] = useState<{ base: string; text: string } | null>(null)
  const [savedBase, setSavedBase] = useState<string | null>(null)
  const draft = edit && edit.base === saved ? edit.text : saved
  const justSaved = savedBase !== null && savedBase === saved && edit === null
  const dirty = draft.trim() !== saved.trim() && draft.trim().length > 0

  return (
    <section
      role="dialog"
      aria-label={translate('projectMap.summary.title', 'Chat summary')}
      data-project-map-window=""
      data-project-map-summary=""
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      className="project-map-window absolute top-16 left-3 bottom-24 z-30 flex w-[420px] max-w-[calc(100%-24px)] flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground"
    >
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border pr-1.5 pl-3">
        <FileText aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13px] leading-[18px] font-semibold">
            {translate('projectMap.summary.title', 'Chat summary')}
          </span>
          <span className="truncate text-[11px] leading-4 text-muted-foreground">
            {projectMapAgentTitle(agent.card)}
          </span>
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={translate('projectMap.summary.close', 'Close')}
          onClick={onClose}
        >
          <XIcon className="size-3.5" />
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3.5 py-3 scrollbar-sleek">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {translate(
            'projectMap.summary.cost',
            'Generating runs your configured model once and may cost money. It only runs when you press Generate.'
          )}
        </p>
        {summary.state.summary ? (
          <p className="flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
            {summary.state.stale ? (
              <span data-project-map-summary-stale="" className="text-foreground">
                {translate(
                  'projectMap.summary.stale',
                  'Out of date: the chat has new messages since this summary.'
                )}
              </span>
            ) : null}
            {summary.state.summary.edited ? (
              <span>{translate('projectMap.summary.edited', 'Edited by you')}</span>
            ) : null}
          </p>
        ) : summary.generating ? (
          <p role="status" className="text-[11px] text-muted-foreground">
            {translate('projectMap.summary.generating', 'Generating…')}
          </p>
        ) : !summary.loading ? (
          <p className="text-[11px] text-muted-foreground">
            {translate('projectMap.summary.none', 'No summary yet.')}
          </p>
        ) : null}
        <Textarea
          rows={14}
          value={draft}
          disabled={summary.loading || summary.generating}
          data-project-map-summary-text=""
          onChange={(event) => setEdit({ base: saved, text: event.target.value })}
          placeholder={translate(
            'projectMap.summary.placeholder',
            'The summary appears here. You can edit it.'
          )}
        />
        {summary.error ? (
          <p role="alert" className="text-[11px] text-destructive">
            {summary.error}
          </p>
        ) : null}
      </div>
      <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-3.5 py-2.5">
        {justSaved ? (
          <span className="mr-auto text-[11px] text-muted-foreground">
            {translate('projectMap.summary.saved', 'Saved')}
          </span>
        ) : null}
        {summary.generating ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-project-map-summary-cancel=""
            onClick={summary.cancel}
          >
            {translate('projectMap.summary.cancel', 'Cancel')}
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={summary.loading}
            data-project-map-summary-generate=""
            onClick={() => {
              setEdit(null)
              summary.generate()
            }}
          >
            {saved
              ? translate('projectMap.summary.regenerate', 'Regenerate')
              : translate('projectMap.summary.generate', 'Generate')}
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          disabled={!dirty || summary.generating}
          data-project-map-summary-save=""
          onClick={() =>
            void summary.save(draft).then((ok) => {
              if (ok) {
                setEdit(null)
                setSavedBase(draft.trim())
              }
            })
          }
        >
          {translate('projectMap.summary.save', 'Save')}
        </Button>
      </footer>
    </section>
  )
}
