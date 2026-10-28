import { useEffect, useMemo, useState } from 'react'
import { GitMerge, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { cn } from '@/lib/utils'
import { dashboardCardDisplayState } from '../../../../shared/dashboard-snapshot'
import type { AgentSessionForkResult } from '../../../../shared/agent-session-fork'
import type { AgentSessionWireRefusal } from '../../../../shared/agent-session-wire'
import { callStructuredAgentSession } from '@/runtime/structured-agent-session-client'
import { structuredAgentSessionTargetForHost } from '@/runtime/structured-agent-session-owner'
import type { ProjectMapAgent } from './project-map-graph'
import { projectMapAgentTitle } from './project-map-labels'
import { projectMapForkRequest } from './project-map-fork-sources'
import { placeProjectMapWindow, type ProjectMapRect } from './project-map-window-placement'
import { hostSupportsAgentSessionForkMerge } from './use-project-map-lineage'
import {
  ProjectMapForkAgentPicker,
  type ProjectMapForkAgentChoice
} from './ProjectMapForkAgentPicker'

const SIZE = { width: 400, height: 560 }

type Props = {
  /** The picked chats, equal sources, in the order they were picked. */
  chats: readonly [ProjectMapAgent, ...ProjectMapAgent[]]
  anchor: ProjectMapRect
  viewport: { width: number; height: number }
  avoid: ProjectMapRect[]
  onClose: () => void
  onCreated: (child: { sessionId: string; tabId?: string }) => void
}

/** One new chat handed several chats' conversations as equals, in a workspace one of them is in. */
export function ProjectMapMergePanel({
  chats,
  anchor,
  viewport,
  avoid,
  onClose,
  onCreated
}: Props): React.JSX.Element {
  const [position] = useState(() => placeProjectMapWindow(anchor, SIZE, viewport, avoid))
  // The protocol names one source first; none is preferred, so it is the first picked.
  const [first, ...others] = chats
  const workspaces = [...new Map(chats.map((chat) => [chat.card.worktreeId, chat.card])).values()]
  const [worktreeId, setWorktreeId] = useState(first.card.worktreeId)
  const [choice, setChoice] = useState<ProjectMapForkAgentChoice>({
    agent: first.chat?.agent ?? first.card.agentType
  })
  const [instruction, setInstruction] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const target = useMemo(
    () => structuredAgentSessionTargetForHost(first.chat?.executionHostId ?? null),
    [first.chat?.executionHostId]
  )
  const [supported, setSupported] = useState<boolean | null>(null)
  useEffect(() => {
    let cancelled = false
    if (target) {
      void hostSupportsAgentSessionForkMerge(target).then(
        (value) => !cancelled && setSupported(value)
      )
    }
    return () => {
      cancelled = true
    }
  }, [target])
  const working = chats.filter((chat) => dashboardCardDisplayState(chat.card) === 'working')

  const create = async (): Promise<void> => {
    setPending(true)
    setError(null)
    try {
      const request = projectMapForkRequest({
        source: { agent: first, depth: 0, cut: { kind: 'latest' } },
        origin: first,
        worktreeId,
        agent: choice.agent,
        ...(choice.model ? { model: choice.model } : {}),
        ...(choice.effort ? { effort: choice.effort } : {}),
        instruction,
        randomUuid: createBrowserUuid,
        mergeWith: others
      })
      if (!target || !request) {
        setError(translate('projectMap.fork.unavailable', 'This chat cannot be continued here.'))
        return
      }
      const result = await callStructuredAgentSession<
        | { ok: true; value: AgentSessionForkResult }
        | { ok: false; refusal: AgentSessionWireRefusal }
      >(target, 'agentSession.fork', request)
      if (!result.ok) {
        setError(result.refusal.message)
        return
      }
      onCreated({
        sessionId: result.value.sessionId,
        ...(result.value.tabId ? { tabId: result.value.tabId } : {})
      })
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setPending(false)
    }
  }

  return (
    <section
      role="dialog"
      aria-label={translate('projectMap.merge.title', 'Merged handoff into a new chat')}
      data-project-map-window=""
      data-project-map-merge-panel=""
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !pending) {
          event.preventDefault()
          void create()
        }
      }}
      className="project-map-window project-map-fork-window absolute z-20 flex flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground"
      style={{
        left: position.x,
        top: position.y,
        width: SIZE.width,
        maxHeight: Math.max(0, viewport.height - position.y - 8)
      }}
    >
      <header className="project-map-window-header flex h-12 shrink-0 items-center gap-2 border-b border-border pr-1.5 pl-3">
        <GitMerge aria-hidden className="project-map-fork-glyph size-4 shrink-0" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13px] leading-[18px] font-semibold">
            {translate('projectMap.merge.title', 'Merged handoff into a new chat')}
          </span>
          <span className="truncate text-[11px] leading-4 text-muted-foreground">
            {translate('projectMap.merge.subtitle', 'From {{count}} chats', {
              count: chats.length
            })}
          </span>
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={translate('projectMap.window.close', 'Close')}
          onClick={onClose}
        >
          <XIcon className="size-3.5" />
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-3.5 py-3 scrollbar-sleek">
        <section className="flex min-w-0 flex-col gap-1">
          <h3 className="mb-1.5 text-[11px] font-semibold text-muted-foreground">
            {translate('projectMap.merge.sources', 'Handed off together')}
          </h3>
          <ul className="flex flex-col gap-1">
            {chats.map((chat) => (
              <li
                key={chat.card.paneKey}
                data-project-map-merge-source={chat.card.paneKey}
                className="flex min-w-0 items-center gap-2 rounded-lg border border-border px-2.5 py-1.5"
              >
                <GitMerge aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[12.5px] font-medium">
                    {projectMapAgentTitle(chat.card)}
                  </span>
                  <span className="truncate text-[11px] text-muted-foreground">
                    {chat.card.worktreeName}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {translate(
              'projectMap.merge.equalHint',
              'Each is handed over in its own section; none comes before the others.'
            )}
          </p>
        </section>
        {workspaces.length > 1 ? (
          <fieldset className="flex min-w-0 flex-col gap-1">
            <legend className="mb-1.5 text-[11px] font-semibold text-muted-foreground">
              {translate('projectMap.merge.workspace', 'New chat goes into')}
            </legend>
            {workspaces.map((card) => (
              <label
                key={card.worktreeId}
                className={cn(
                  'flex cursor-pointer items-center gap-2.5 rounded-lg border px-2.5 py-1.5',
                  card.worktreeId === worktreeId
                    ? 'border-ring bg-accent/60'
                    : 'border-transparent hover:bg-accent/40'
                )}
              >
                <input
                  type="radio"
                  name="project-map-merge-workspace"
                  className="accent-current"
                  checked={card.worktreeId === worktreeId}
                  onChange={() => setWorktreeId(card.worktreeId)}
                />
                <span className="truncate text-[12.5px] font-medium">{card.worktreeName}</span>
              </label>
            ))}
          </fieldset>
        ) : null}
        <ProjectMapForkAgentPicker origin={first} choice={choice} onChange={setChoice} />
        <p className="-mt-2 text-[11px] leading-relaxed text-muted-foreground">
          {translate(
            'projectMap.merge.handoffHint',
            'Each chat is handed over as text, through its last completed turn; the longest are cut first, with a link to the rest.'
          )}
        </p>
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold text-muted-foreground">
            {translate('projectMap.fork.instruction', 'First instruction (optional)')}
          </span>
          <Textarea
            rows={3}
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder={translate(
              'projectMap.fork.instructionPlaceholder',
              'Empty: the chat opens and waits for you.'
            )}
          />
        </label>
        {supported === false ? (
          <p className="text-[11px] text-muted-foreground">
            {translate(
              'projectMap.merge.hostUnsupported',
              "This chat's host runs an Orca version that cannot merge chats; update it to merge here."
            )}
          </p>
        ) : null}
        {working.length > 0 ? (
          <p className="text-[11px] text-muted-foreground">
            {translate(
              'projectMap.merge.working',
              '{{name}} is still working; merge once its turn ends.',
              { name: projectMapAgentTitle(working[0]!.card) }
            )}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-[11px] text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      <footer className="flex shrink-0 justify-end gap-2 border-t border-border px-3.5 py-2.5">
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          {translate('projectMap.fork.cancel', 'Cancel')}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={pending || supported !== true || working.length > 0}
          onClick={() => void create()}
        >
          {pending
            ? translate('projectMap.fork.creating', 'Creating…')
            : translate('projectMap.merge.create', 'Create merged handoff')}
        </Button>
      </footer>
    </section>
  )
}
