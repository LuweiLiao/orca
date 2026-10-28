import { useEffect, useMemo, useRef, useState } from 'react'
import { GitBranch, MessageSquare, MessageSquareText, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import { highlightedSearchSnippet } from '@/components/right-sidebar/AiVaultSearchEvidence'
import type { ProjectMapGraph } from './project-map-graph'
import { searchProjectMap } from './project-map-search'
import { projectMapAgentTitle } from './project-map-labels'
import { useProjectMapMessageSearch } from './use-project-map-message-search'

type Props = {
  graph: ProjectMapGraph
  branchOf: (worktreeId: string) => string | null
  onPick: (id: string) => void
  onClose: () => void
}

type Row =
  | { key: string; id: string; kind: 'title'; title: string; detail: string; workspace: boolean }
  | { key: string; id: string; kind: 'message'; title: string; snippet: string }

/** Finds a chat or workspace on the map by title, task, branch or state, and chats by what they said. */
export function ProjectMapSearch({ graph, branchOf, onPick, onClose }: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const titleHits = useMemo(
    () => searchProjectMap(graph, query, branchOf),
    [branchOf, graph, query]
  )
  const messages = useProjectMapMessageSearch(graph, query)
  const rows = useMemo<Row[]>(
    () => [
      ...titleHits.map<Row>((hit) => ({
        key: `title:${hit.id}`,
        id: hit.id,
        kind: 'title',
        title: hit.title,
        detail: hit.closed ? translate('projectMap.node.closed', 'Closed') : hit.detail,
        workspace: hit.kind === 'workspace'
      })),
      ...messages.hits.flatMap<Row>((hit) => {
        const agent = graph.agents.get(hit.paneKey)
        return agent
          ? [
              {
                key: `message:${hit.sessionId}`,
                id: hit.paneKey,
                kind: 'message',
                title: projectMapAgentTitle(agent.card),
                snippet: hit.snippet
              }
            ]
          : []
      })
    ],
    [graph.agents, messages.hits, titleHits]
  )
  const current = Math.min(active, Math.max(0, rows.length - 1))
  useEffect(() => {
    inputRef.current?.focus()
  }, [])
  const pick = (id: string): void => {
    onPick(id)
    onClose()
  }
  const firstMessage = rows.findIndex((row) => row.kind === 'message')
  const status = messageStatus(messages, query)
  return (
    <section
      role="search"
      aria-label={translate('projectMap.search.label', 'Search the map')}
      data-project-map-window=""
      data-project-map-search=""
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      className="project-map-window absolute top-3 left-1/2 z-30 flex w-[400px] max-w-[calc(100%-24px)] -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground"
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <Search aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={query}
          role="combobox"
          aria-expanded={rows.length > 0}
          aria-controls="project-map-search-results"
          aria-label={translate('projectMap.search.label', 'Search the map')}
          placeholder={translate(
            'projectMap.search.placeholder',
            'Title, task, branch, state or what was said'
          )}
          density="compact"
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              onClose()
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              const step = event.key === 'ArrowDown' ? 1 : -1
              setActive((current + step + rows.length) % Math.max(1, rows.length))
            } else if (event.key === 'Enter' && rows[current]) {
              event.preventDefault()
              pick(rows[current].id)
            }
          }}
        />
      </div>
      {query.trim() ? (
        <ul
          id="project-map-search-results"
          role="listbox"
          className="max-h-80 overflow-y-auto border-t border-border p-1 scrollbar-sleek"
        >
          {rows.length === 0 && !messages.loading ? (
            <li className="px-2 py-2 text-xs text-muted-foreground">
              {translate('projectMap.search.empty', 'Nothing on this map matches')}
            </li>
          ) : null}
          {rows.map((row, index) => (
            <li key={row.key} role="option" aria-selected={index === current}>
              {index === firstMessage ? (
                <div className="px-2 pt-2 pb-1 text-[11px] font-semibold text-muted-foreground">
                  {translate('projectMap.search.inMessages', 'In messages')}
                </div>
              ) : null}
              <button
                type="button"
                data-project-map-search-hit={row.id}
                data-project-map-search-kind={row.kind}
                tabIndex={-1}
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(row.id)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs data-[active=true]:bg-accent data-[active=true]:text-accent-foreground"
                data-active={index === current}
              >
                {row.kind === 'title' ? (
                  <>
                    {row.workspace ? (
                      <GitBranch aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <MessageSquare
                        aria-hidden
                        className="size-3.5 shrink-0 text-muted-foreground"
                      />
                    )}
                    <span className="min-w-0 flex-1 truncate font-medium">{row.title}</span>
                    <span className="max-w-[40%] shrink-0 truncate text-[11px] text-muted-foreground">
                      {row.detail}
                    </span>
                  </>
                ) : (
                  <>
                    <MessageSquareText
                      aria-hidden
                      className="size-3.5 shrink-0 self-start text-muted-foreground"
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium">{row.title}</span>
                      <span className="line-clamp-2 text-[11px] text-muted-foreground [&_mark]:bg-accent [&_mark]:text-accent-foreground">
                        {highlightedSearchSnippet(row.snippet)}
                      </span>
                    </span>
                  </>
                )}
              </button>
            </li>
          ))}
          {status ? (
            <li
              data-project-map-search-status=""
              className="px-2 py-1.5 text-[11px] text-muted-foreground"
            >
              {status}
            </li>
          ) : null}
        </ul>
      ) : null}
    </section>
  )
}

function messageStatus(
  messages: ReturnType<typeof useProjectMapMessageSearch>,
  query: string
): string | null {
  if (query.trim().length < 2) {
    return null
  }
  if (messages.loading) {
    return translate('projectMap.search.messagesLoading', 'Searching messages…')
  }
  const parts = [
    messages.skipped === 'off'
      ? translate(
          'projectMap.search.messagesOff',
          'Message search is off on some computers; turn it on in Settings to search what was said.'
        )
      : messages.skipped === 'not-ready'
        ? translate('projectMap.search.messagesNotReady', 'Messages are still being indexed.')
        : messages.skipped === 'unavailable'
          ? translate('projectMap.search.messagesUnavailable', 'Message search is unavailable.')
          : null,
    messages.elsewhere > 0
      ? translate(
          'projectMap.search.messagesElsewhere',
          '{{count}} more chats match off this map',
          {
            count: messages.elsewhere
          }
        )
      : null
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : null
}
