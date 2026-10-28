import { Columns2, X } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import type { AgentSessionConversationOutlineEntry } from '../../../../shared/agent-session-conversation-outline'
import type { ProjectMapAgent } from './project-map-graph'
import { projectMapAgentTitle } from './project-map-labels'
import {
  projectMapBranchRelation,
  projectMapTurnsAfterCut,
  type ProjectMapBranchRelation
} from './project-map-branch-compare'
import {
  projectMapTimelineNode,
  useProjectMapSessionRelations
} from './project-map-session-relations'
import { useProjectMapOutline } from './use-project-map-outline'

type Props = {
  pair: readonly [ProjectMapAgent, ProjectMapAgent]
  onSelectNode: (paneKey: string) => void
  onClose: () => void
}

/** Two chats side by side: where they parted, and the turns each has had since. */
export function ProjectMapComparePanel({ pair, onSelectNode, onClose }: Props): React.JSX.Element {
  const relations = useProjectMapSessionRelations()
  const [a, b] = pair
  const relation: ProjectMapBranchRelation =
    a.chat && b.chat
      ? projectMapBranchRelation(a.chat.sessionId, b.chat.sessionId, (child) =>
          relations.lineage.get(child)
        )
      : { kind: 'unrelated' }
  const titleOf = (sessionId: string): string => projectMapTimelineNode(relations, sessionId).title
  return (
    <section
      aria-label={translate('projectMap.compare.title', 'Compare branches')}
      data-project-map-window=""
      data-project-map-compare=""
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      className="project-map-window absolute top-3 right-3 bottom-24 z-30 flex w-[560px] max-w-[calc(100%-24px)] flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground"
    >
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <Columns2 aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-[13px] font-semibold">
          {translate('projectMap.compare.title', 'Compare branches')}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          className="ml-auto"
          aria-label={translate('projectMap.window.close', 'Close')}
          onClick={onClose}
        >
          <X />
        </Button>
      </header>
      <p
        data-project-map-compare-relation={relation.kind}
        className="shrink-0 border-b border-border px-3 py-2 text-[12px] leading-snug text-muted-foreground"
      >
        {relation.kind === 'ancestor'
          ? translate(
              'projectMap.compare.ancestor',
              '"{{descendant}}" was handed off from "{{ancestor}}" after its first {{count}} messages.',
              {
                descendant: titleOf(relation.descendant),
                ancestor: titleOf(relation.ancestor),
                count: relation.cut.messageCount
              }
            )
          : relation.kind === 'siblings'
            ? translate(
                'projectMap.compare.siblings',
                'Both were handed off from "{{common}}": one after {{first}} messages, the other after {{second}}.',
                {
                  common: titleOf(relation.common),
                  first: relation.cuts[a.chat?.sessionId ?? '']?.messageCount ?? 0,
                  second: relation.cuts[b.chat?.sessionId ?? '']?.messageCount ?? 0
                }
              )
            : translate(
                'projectMap.compare.unrelated',
                'Neither was handed off from the other, nor from a common chat.'
              )}
      </p>
      <div className="grid min-h-0 flex-1 grid-cols-2 divide-x divide-border">
        <Column agent={a} relation={relation} onSelectNode={onSelectNode} />
        <Column agent={b} relation={relation} onSelectNode={onSelectNode} />
      </div>
    </section>
  )
}

function Column({
  agent,
  relation,
  onSelectNode
}: {
  agent: ProjectMapAgent
  relation: ProjectMapBranchRelation
  onSelectNode: (paneKey: string) => void
}): React.JSX.Element {
  const read = useProjectMapOutline(
    agent.chat,
    `${agent.card.stateChangedAt}:${agent.card.dotState}`
  )
  const isAncestor = relation.kind === 'ancestor' && relation.ancestor === agent.chat?.sessionId
  const all =
    read.state === 'ready' ? [...read.outline.entries].sort((x, y) => x.sequence - y.sequence) : []
  const first = read.state === 'ready' ? read.outline.omittedEntries + 1 : 1
  // The ancestor's turns up to the hand-off are the other chat's too; only the rest are its own.
  const after =
    isAncestor && read.state === 'ready'
      ? projectMapTurnsAfterCut(all, relation.cut, read.outline.cursor.epoch)
      : all
  // A text hand-off opens with the transcript it was handed, which is the other side's story.
  const handedText = agent.fork?.mode === 'transcript' && read.state === 'ready'
  const opening = handedText && read.outline.omittedEntries === 0 ? all[0]?.itemId : undefined
  const turns = (after ?? all).filter((turn) => turn.itemId !== opening)
  const numberOf = (turn: AgentSessionConversationOutlineEntry): number => first + all.indexOf(turn)
  return (
    <div data-project-map-compare-column={agent.card.paneKey} className="flex min-h-0 flex-col">
      <button
        type="button"
        onClick={() => onSelectNode(agent.card.paneKey)}
        className="flex shrink-0 flex-col gap-0.5 border-b border-border px-3 py-2 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <span className="truncate text-[12px] font-semibold">
          {projectMapAgentTitle(agent.card)}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {read.state !== 'ready'
            ? read.state === 'loading'
              ? translate('projectMap.compare.loading', 'Reading turns…')
              : translate('projectMap.compare.unavailable', 'Its turns cannot be read here')
            : isAncestor && after
              ? translate('projectMap.compare.since', '{{count}} turns since the handoff', {
                  count: turns.length
                })
              : isAncestor
                ? translate(
                    'projectMap.compare.rewound',
                    'Rewound since the handoff; showing all {{count}} turns',
                    { count: turns.length }
                  )
                : translate('projectMap.compare.own', '{{count}} turns of its own', {
                    count: turns.length
                  })}
        </span>
      </button>
      <ol className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 py-2 scrollbar-sleek">
        {turns.map((turn) => (
          <li key={turn.itemId} className="flex min-w-0 gap-1.5 px-1">
            <span className="w-5 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
              {numberOf(turn)}
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
          </li>
        ))}
      </ol>
    </div>
  )
}
