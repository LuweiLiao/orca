import { useEffect, useMemo, useState } from 'react'
import { GitBranchPlus, GitFork, Link2, Undo2 } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { structuredAgentSessionTargetForHost } from '@/runtime/structured-agent-session-owner'
import { requestNativeChatNavigation } from '@/components/native-chat/native-chat-outside-navigation'
import type { ProjectMapAgent } from './project-map-graph'
import {
  projectMapTimeline,
  type ProjectMapTimelineFork,
  type ProjectMapTimelineNode,
  type ProjectMapTimelineReference
} from './project-map-timeline'
import {
  projectMapTimelineNode,
  useProjectMapSessionRelations
} from './project-map-session-relations'
import type { ProjectMapForkAt } from './project-map-fork-sources'
import { hostSupportsAgentSessionForkMerge } from './use-project-map-lineage'
import { useProjectMapOutline } from './use-project-map-outline'

type Props = {
  agent: ProjectMapAgent
  /** The window holding this chat's transcript, which answers jumps and rewinds. */
  scope: React.RefObject<HTMLElement | null>
  onSelectNode: (paneKey: string) => void
  /** Present when this chat can seed a child: start one from the end of a turn. */
  onForkAt?: (at: ProjectMapForkAt) => void
}

/** A chat's turns beside its transcript, with what forked off each and what each one referenced. */
export function ProjectMapTimeline({
  agent,
  scope,
  onSelectNode,
  onForkAt
}: Props): React.JSX.Element | null {
  const chat = agent.chat
  const target = useMemo(
    () => structuredAgentSessionTargetForHost(chat?.executionHostId ?? null),
    [chat?.executionHostId]
  )
  // Re-read when the chat moves on, so a finished turn and a new fork show up.
  const read = useProjectMapOutline(chat, `${agent.card.stateChangedAt}:${agent.card.dotState}`)
  const relations = useProjectMapSessionRelations()
  // An older host refuses a cut at a message, so the action shows only where the host takes one.
  const [forksAtMessage, setForksAtMessage] = useState(false)
  useEffect(() => {
    if (!target || !onForkAt) {
      return
    }
    let cancelled = false
    void hostSupportsAgentSessionForkMerge(target).then((supported) => {
      if (!cancelled) {
        setForksAtMessage(supported)
      }
    })
    return () => {
      cancelled = true
    }
  }, [onForkAt, target])
  const timeline = useMemo(
    () =>
      chat && read.state === 'ready'
        ? projectMapTimeline({
            sessionId: chat.sessionId,
            outline: read.outline,
            lineage: relations.lineage.values(),
            references: relations.references,
            nodeOf: (sessionId) => projectMapTimelineNode(relations, sessionId)
          })
        : null,
    [chat, read, relations]
  )
  if (!chat) {
    return null
  }
  const navigate = (messageId: string, rewind?: true): void => {
    if (scope.current) {
      requestNativeChatNavigation({
        scope: scope.current,
        messageId,
        ...(rewind ? { rewind } : {})
      })
    }
  }
  const forkedFrom = agent.fork
    ? projectMapTimelineNode(relations, agent.fork.entry.sourceSessionId)
    : null
  return (
    <aside
      aria-label={translate('projectMap.timeline.title', 'Timeline')}
      data-project-map-timeline=""
      className="flex w-[232px] shrink-0 flex-col border-r border-border bg-muted/20"
    >
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border px-3 text-[11px] font-semibold text-muted-foreground">
        {translate('projectMap.timeline.title', 'Timeline')}
        {timeline ? (
          <span className="font-normal">
            {translate('projectMap.timeline.turnCount', '{{count}} turns', {
              count: timeline.turns.length + timeline.omittedTurns
            })}
          </span>
        ) : null}
      </div>
      <ol className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1.5 py-2 scrollbar-sleek">
        {forkedFrom && agent.fork ? (
          <li className="px-1.5 pb-1.5 text-[11px] leading-snug text-muted-foreground">
            <MarkerChip
              icon="fork"
              node={forkedFrom}
              detail={translate(
                'projectMap.timeline.forkedFromDetail',
                'handed {{count}} messages',
                {
                  count: agent.fork.entry.handedOverCount ?? agent.fork.messageCount
                }
              )}
              prefix={translate('projectMap.timeline.forkedFrom', 'Handed off from')}
              onSelectNode={onSelectNode}
            />
          </li>
        ) : null}
        {timeline && timeline.omittedTurns > 0 ? (
          <li className="px-1.5 pb-1 text-[11px] text-muted-foreground">
            {translate('projectMap.timeline.omitted', '{{count}} earlier turns not listed', {
              count: timeline.omittedTurns
            })}
          </li>
        ) : null}
        {timeline?.turns.map((turn, index) => (
          <li
            key={turn.itemId}
            data-project-map-timeline-turn={turn.itemId}
            className="group relative flex flex-col gap-1 rounded-md px-1.5 py-1.5 hover:bg-accent/50"
          >
            <button
              type="button"
              onClick={() => navigate(turn.itemId)}
              className="flex min-w-0 gap-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            >
              <span className="w-5 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                {index + 1 + timeline.omittedTurns}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="line-clamp-2 text-[12px] leading-snug">
                  {turn.preview ||
                    (turn.imageCount > 0
                      ? translate('projectMap.timeline.imageOnly', 'Image')
                      : translate('projectMap.timeline.emptyMessage', 'Message'))}
                </span>
                {turn.reply ? (
                  <span className="line-clamp-1 text-[11px] leading-snug text-muted-foreground">
                    {turn.reply}
                  </span>
                ) : null}
              </span>
            </button>
            <span className="absolute top-1 right-1 hidden gap-0.5 group-focus-within:flex group-hover:flex">
              {onForkAt && forksAtMessage && read.state === 'ready' ? (
                <TurnAction
                  label={translate('projectMap.timeline.forkHere', 'New child chat from here')}
                  marker="fork"
                  onClick={() =>
                    onForkAt({
                      itemId: turn.itemId,
                      epoch: read.outline.cursor.epoch,
                      turn: index + 1 + timeline.omittedTurns,
                      preview: turn.preview,
                      last: index === timeline.turns.length - 1
                    })
                  }
                >
                  <GitBranchPlus aria-hidden className="size-3" />
                </TurnAction>
              ) : null}
              {agent.history ? null : (
                <TurnAction
                  label={translate('projectMap.timeline.rewind', 'Rewind to here')}
                  marker="rewind"
                  onClick={() => navigate(turn.itemId, true)}
                >
                  <Undo2 aria-hidden className="size-3" />
                </TurnAction>
              )}
            </span>
            <Markers
              forks={turn.forks}
              references={turn.referencesSent}
              onSelectNode={onSelectNode}
            />
          </li>
        ))}
        {timeline && timeline.unplacedReferencesSent.length > 0 ? (
          <Section
            title={translate('projectMap.timeline.otherReferences', 'Other references sent')}
          >
            <Markers
              forks={[]}
              references={timeline.unplacedReferencesSent}
              onSelectNode={onSelectNode}
            />
          </Section>
        ) : null}
        {timeline && timeline.rewoundForks.length > 0 ? (
          <Section
            title={translate('projectMap.timeline.rewoundForks', 'Handed off before a rewind')}
          >
            <Markers forks={timeline.rewoundForks} references={[]} onSelectNode={onSelectNode} />
          </Section>
        ) : null}
        {timeline && timeline.referencedBy.length > 0 ? (
          <Section title={translate('projectMap.timeline.referencedBy', 'Referenced by')}>
            <Markers forks={[]} references={timeline.referencedBy} onSelectNode={onSelectNode} />
          </Section>
        ) : null}
        {read.state !== 'ready' ? (
          <li className="px-1.5 py-2 text-[11px] text-muted-foreground">
            {read.state === 'loading'
              ? translate('projectMap.timeline.loading', 'Reading the conversation…')
              : read.state === 'unsupported'
                ? translate(
                    'projectMap.timeline.unsupported',
                    "This chat's host runs an Orca version without a timeline."
                  )
                : translate('projectMap.timeline.failed', 'Could not read the conversation.')}
          </li>
        ) : null}
      </ol>
    </aside>
  )
}

function TurnAction({
  label,
  marker,
  onClick,
  children
}: {
  label: string
  marker: 'fork' | 'rewind'
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-project-map-timeline-action={marker}
      onClick={onClick}
      className="grid size-5 place-items-center rounded-sm bg-background/80 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </button>
  )
}

function Section({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <li className="mt-2 flex flex-col gap-1 border-t border-border px-1.5 pt-2">
      <span className="text-[11px] font-semibold text-muted-foreground">{title}</span>
      {children}
    </li>
  )
}

function Markers({
  forks,
  references,
  onSelectNode
}: {
  forks: readonly ProjectMapTimelineFork[]
  references: readonly ProjectMapTimelineReference[]
  onSelectNode: (paneKey: string) => void
}): React.JSX.Element | null {
  if (forks.length === 0 && references.length === 0) {
    return null
  }
  return (
    <span className="flex flex-col gap-0.5 pl-6">
      {forks.map((fork) => (
        <MarkerChip
          key={`fork:${fork.childSessionId}`}
          icon="fork"
          node={fork.node}
          detail={translate('projectMap.timeline.forkDetail', '{{count}} messages', {
            count: fork.messageCount
          })}
          onSelectNode={onSelectNode}
        />
      ))}
      {references.map((reference) => (
        <MarkerChip
          key={`reference:${reference.id}`}
          icon="reference"
          node={reference.node}
          detail={
            reference.snapshotCount === null
              ? translate('projectMap.timeline.live', 'live')
              : translate('projectMap.timeline.snapshot', 'first {{count}} messages', {
                  count: reference.snapshotCount
                })
          }
          onSelectNode={onSelectNode}
        />
      ))}
    </span>
  )
}

function MarkerChip({
  icon,
  node,
  detail,
  prefix,
  onSelectNode
}: {
  icon: 'fork' | 'reference'
  node: ProjectMapTimelineNode
  detail: string
  prefix?: string
  onSelectNode: (paneKey: string) => void
}): React.JSX.Element {
  const Glyph = icon === 'fork' ? GitFork : Link2
  const { paneKey } = node
  return (
    <button
      type="button"
      disabled={paneKey === null}
      data-project-map-timeline-marker={icon}
      onClick={() => paneKey && onSelectNode(paneKey)}
      className={cn(
        'flex min-w-0 items-center gap-1 rounded-sm text-left text-[11px] leading-snug focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        icon === 'fork' ? 'project-map-fork-source' : 'project-map-reference-count',
        paneKey ? 'hover:underline' : 'cursor-default opacity-70'
      )}
    >
      <Glyph aria-hidden className="size-3 shrink-0" />
      <span className="truncate">
        {prefix ? `${prefix} ` : ''}
        {node.title}
      </span>
      <span className="shrink-0 text-muted-foreground">· {detail}</span>
    </button>
  )
}
