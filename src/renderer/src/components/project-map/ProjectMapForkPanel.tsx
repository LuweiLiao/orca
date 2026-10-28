import { useEffect, useMemo, useState } from 'react'
import { GitFork, XIcon } from 'lucide-react'
import { NativeChatConversationReference } from '@/components/native-chat/NativeChatConversationReference'
import { readConversationReferenceDrag } from '@/lib/conversation-reference-drag'
import type { ConversationReference } from '../../../../shared/conversation-reference'
import { toRuntimeExecutionHostId } from '../../../../shared/execution-host'
import { carriesConversationReference } from './project-map-reference-drop'
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
import {
  projectMapForkRequest,
  projectMapForkSources,
  type ProjectMapForkAt
} from './project-map-fork-sources'
import { placeProjectMapWindow, type ProjectMapRect } from './project-map-window-placement'
import { ProjectMapForkSummaryOption } from './ProjectMapForkSummaryOption'
import { projectMapHandoffInstruction } from './project-map-summary'
import {
  ProjectMapForkAgentPicker,
  type ProjectMapForkAgentChoice
} from './ProjectMapForkAgentPicker'

const SIZE = { width: 400, height: 560 }

type Props = {
  origin: ProjectMapAgent
  agents: ReadonlyMap<string, ProjectMapAgent>
  anchor: ProjectMapRect
  viewport: { width: number; height: number }
  avoid: ProjectMapRect[]
  onClose: () => void
  onCreated: (child: { sessionId: string; tabId?: string }) => void
  /** Picked on the timeline: the child starts from the end of that turn, not the latest one. */
  at?: ProjectMapForkAt
}

function relationLabel(depth: number): string {
  return depth === 0
    ? translate('projectMap.fork.relation.self', 'This chat')
    : depth === 1
      ? translate('projectMap.fork.relation.parent', 'Parent')
      : depth === 2
        ? translate('projectMap.fork.relation.grandparent', 'Grandparent')
        : translate('projectMap.fork.relation.ancestor', '{{count}} levels up', { count: depth })
}

export function ProjectMapForkPanel({
  origin,
  agents,
  anchor,
  viewport,
  avoid,
  onClose,
  onCreated,
  at
}: Props): React.JSX.Element {
  const [position] = useState(() => placeProjectMapWindow(anchor, SIZE, viewport, avoid))
  const sources = useMemo(
    () =>
      at
        ? [
            {
              agent: origin,
              depth: 0,
              cut: { kind: 'message' as const, itemId: at.itemId, epoch: at.epoch }
            }
          ]
        : projectMapForkSources(origin, agents),
    [agents, at, origin]
  )
  const [sourceIndex, setSourceIndex] = useState(0)
  const source = sources[sourceIndex] ?? sources[0]
  const [choice, setChoice] = useState<ProjectMapForkAgentChoice>({
    agent: origin.chat?.agent ?? origin.card.agentType
  })
  const [instruction, setInstruction] = useState('')
  const [summary, setSummary] = useState<string | null>(null)
  // Other chats this child should read too, beside the one it inherits.
  const [references, setReferences] = useState<ConversationReference[]>([])
  const [dropping, setDropping] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sourceWorking =
    (source?.cut.kind === 'latest' || (source?.cut.kind === 'message' && at?.last === true)) &&
    dashboardCardDisplayState(source.agent.card) === 'working'
  const busyNeighbours = useMemo(
    () =>
      [...agents.values()].filter(
        (agent) =>
          agent !== origin &&
          agent.card.worktreeId === origin.card.worktreeId &&
          dashboardCardDisplayState(agent.card) === 'working'
      ),
    [agents, origin]
  )
  const sameAgent = choice.agent === source?.agent.chat?.agent
  // A cut at a picked message has no point Claude recorded, so it always travels as text.
  const native =
    sameAgent &&
    source?.cut.kind !== 'message' &&
    choice.agent === 'claude' &&
    source?.agent.card.worktreeId === origin.card.worktreeId

  useEffect(() => {
    setError(null)
  }, [sourceIndex, choice.agent])

  const target = structuredAgentSessionTargetForHost(origin.chat?.executionHostId)
  const addReference = async (event: React.DragEvent<HTMLElement>): Promise<void> => {
    setDropping(false)
    const dropped = readConversationReferenceDrag(event.dataTransfer)
    if (!dropped) {
      return
    }
    event.preventDefault()
    // The child runs on the chat's host; it can read only references that host can reach.
    const environment = target?.kind === 'environment' ? target.environmentId : undefined
    if (environment && dropped.executionHostId !== toRuntimeExecutionHostId(environment)) {
      setError(
        translate(
          'components.native-chat.conversationReference.differentHost',
          'This agent cannot reach the conversation on its source host. Open the chat on that host to reference it.'
        )
      )
      return
    }
    try {
      const made = await window.api.aiVault.createConversationReference(dropped)
      setReferences((current) =>
        current.some((reference) => reference.uri === made.uri) ? current : [...current, made]
      )
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }
  // Typed text first so the child is named for it; references after, with how to read them.
  const firstInstruction = projectMapHandoffInstruction({ summary, instruction, references })

  const create = async (): Promise<void> => {
    setPending(true)
    setError(null)
    try {
      const request = source
        ? projectMapForkRequest({
            source,
            origin,
            agent: choice.agent,
            ...(choice.model ? { model: choice.model } : {}),
            ...(choice.effort ? { effort: choice.effort } : {}),
            instruction: firstInstruction,
            randomUuid: createBrowserUuid
          })
        : null
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
      aria-label={translate('projectMap.fork.title', 'New child chat')}
      data-project-map-window=""
      data-project-map-fork-panel=""
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      data-reference-drop={dropping || undefined}
      onDragOver={(event) => {
        if (carriesConversationReference(event)) {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
          setDropping(true)
        }
      }}
      onDragLeave={(event) => {
        const next = event.relatedTarget
        if (!(next instanceof Node) || !event.currentTarget.contains(next)) {
          setDropping(false)
        }
      }}
      onDrop={(event) => void addReference(event)}
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
        // Below its own top, so the footer with Create stays on screen.
        maxHeight: Math.max(0, viewport.height - position.y - 8)
      }}
    >
      <header className="project-map-window-header flex h-12 shrink-0 items-center gap-2 border-b border-border pr-1.5 pl-3">
        <GitFork aria-hidden className="project-map-fork-glyph size-4 shrink-0" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13px] leading-[18px] font-semibold">
            {translate('projectMap.fork.title', 'New child chat')}
          </span>
          <span className="truncate text-[11px] leading-4 text-muted-foreground">
            {translate('projectMap.fork.subtitle', 'From {{name}}', {
              name: projectMapAgentTitle(origin.card)
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
        <fieldset className="flex min-w-0 flex-col gap-1">
          <legend className="mb-1.5 text-[11px] font-semibold text-muted-foreground">
            {translate('projectMap.fork.inheritFrom', 'Inherit from')}
          </legend>
          {sources.map((candidate, index) => {
            const chosen = index === sourceIndex
            return (
              <label
                key={candidate.agent.card.paneKey}
                className={cn(
                  'flex cursor-pointer items-center gap-2.5 rounded-lg border px-2.5 py-1.5',
                  chosen ? 'border-ring bg-accent/60' : 'border-transparent hover:bg-accent/40'
                )}
              >
                <input
                  type="radio"
                  name="project-map-fork-source"
                  className="accent-current"
                  checked={chosen}
                  onChange={() => setSourceIndex(index)}
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[12.5px] font-medium">
                    {projectMapAgentTitle(candidate.agent.card)}
                  </span>
                  <span className="truncate text-[11px] text-muted-foreground">
                    {candidate.cut.kind === 'fork-point'
                      ? translate(
                          'projectMap.fork.cutForkPoint',
                          'Where it handed off the next chat'
                        )
                      : candidate.cut.kind === 'message' && at
                        ? translate(
                            'projectMap.fork.cutMessage',
                            'Through turn {{turn}}: {{preview}}',
                            {
                              turn: at.turn,
                              preview: at.preview
                            }
                          )
                        : translate('projectMap.fork.cutLatest', 'Through its last completed turn')}
                  </span>
                </span>
                <span className="shrink-0 rounded bg-muted px-1.5 text-[10.5px] leading-[18px] text-muted-foreground">
                  {relationLabel(candidate.depth)}
                </span>
              </label>
            )
          })}
        </fieldset>
        <ProjectMapForkSummaryOption source={source?.agent} onChange={setSummary} />
        <ProjectMapForkAgentPicker origin={origin} choice={choice} onChange={setChoice} />
        <p className="-mt-2 text-[11px] leading-relaxed text-muted-foreground">
          {native
            ? translate(
                'projectMap.fork.nativeHint',
                'Copies the saved conversation, tool calls included; without one, hands over its messages as text.'
              )
            : translate(
                'projectMap.fork.handoffHint',
                'Hands over the messages as text: tool output and images are summarised, not copied.'
              )}
        </p>
        {busyNeighbours.length > 0 ? (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {translate(
              'projectMap.fork.sharedWorkspace',
              '{{name}} is also working in this workspace; both may edit the same files.',
              { name: projectMapAgentTitle(busyNeighbours[0]!.card) }
            )}
          </p>
        ) : null}
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold text-muted-foreground">
            {translate('projectMap.fork.instruction', 'First instruction (optional)')}
          </span>
          {references.length > 0 ? (
            <span className="flex flex-wrap gap-1">
              {references.map((reference) => (
                <NativeChatConversationReference
                  key={reference.uri}
                  uri={reference.uri}
                  title={reference.title}
                  onRemove={() =>
                    setReferences((current) =>
                      current.filter((candidate) => candidate.uri !== reference.uri)
                    )
                  }
                />
              ))}
            </span>
          ) : null}
          <Textarea
            rows={3}
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder={translate(
              'projectMap.fork.instructionPlaceholder',
              'Empty: the chat opens and waits for you.'
            )}
          />
          <span className="text-[11px] text-muted-foreground">
            {translate(
              'projectMap.fork.referenceHint',
              'Drag other chats from the map here to have this one read them too.'
            )}
          </span>
        </label>
        {sourceWorking ? (
          <p className="text-[11px] text-muted-foreground">
            {translate(
              'projectMap.fork.sourceWorking',
              'That chat is still working; hand it off once its turn ends.'
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
          disabled={pending || !source || sourceWorking}
          onClick={() => void create()}
        >
          {pending
            ? translate('projectMap.fork.creating', 'Creating…')
            : translate('projectMap.fork.create', 'Create child chat')}
        </Button>
      </footer>
    </section>
  )
}
