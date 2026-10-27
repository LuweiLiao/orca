import { useEffect, useMemo, useRef, useState } from 'react'
import { GitBranch, MessageSquare, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import type { ProjectMapGraph } from './project-map-graph'
import { searchProjectMap } from './project-map-search'

type Props = {
  graph: ProjectMapGraph
  branchOf: (worktreeId: string) => string | null
  onPick: (id: string) => void
  onClose: () => void
}

/** Finds a chat or workspace on the map by title, task, branch or state. */
export function ProjectMapSearch({ graph, branchOf, onPick, onClose }: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const hits = useMemo(() => searchProjectMap(graph, query, branchOf), [branchOf, graph, query])
  const current = Math.min(active, Math.max(0, hits.length - 1))
  useEffect(() => {
    inputRef.current?.focus()
  }, [])
  const pick = (id: string): void => {
    onPick(id)
    onClose()
  }
  return (
    <section
      role="search"
      aria-label={translate('projectMap.search.label', 'Search the map')}
      data-project-map-window=""
      data-project-map-search=""
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      className="project-map-window absolute top-3 left-1/2 z-30 flex w-[360px] max-w-[calc(100%-24px)] -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground"
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <Search aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={query}
          role="combobox"
          aria-expanded={hits.length > 0}
          aria-controls="project-map-search-results"
          aria-label={translate('projectMap.search.label', 'Search the map')}
          placeholder={translate('projectMap.search.placeholder', 'Title, task, branch or state')}
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
              setActive((current + step + hits.length) % Math.max(1, hits.length))
            } else if (event.key === 'Enter' && hits[current]) {
              event.preventDefault()
              pick(hits[current].id)
            }
          }}
        />
      </div>
      {query.trim() ? (
        <ul
          id="project-map-search-results"
          role="listbox"
          className="max-h-72 overflow-y-auto border-t border-border p-1 scrollbar-sleek"
        >
          {hits.length === 0 ? (
            <li className="px-2 py-2 text-xs text-muted-foreground">
              {translate('projectMap.search.empty', 'Nothing on this map matches')}
            </li>
          ) : (
            hits.map((hit, index) => {
              const Glyph = hit.kind === 'workspace' ? GitBranch : MessageSquare
              return (
                <li key={hit.id} role="option" aria-selected={index === current}>
                  <button
                    type="button"
                    data-project-map-search-hit={hit.id}
                    tabIndex={-1}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => pick(hit.id)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs data-[active=true]:bg-accent data-[active=true]:text-accent-foreground"
                    data-active={index === current}
                  >
                    <Glyph aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-medium">{hit.title}</span>
                    <span className="max-w-[40%] shrink-0 truncate text-[11px] text-muted-foreground">
                      {hit.closed ? translate('projectMap.node.closed', 'Closed') : hit.detail}
                    </span>
                  </button>
                </li>
              )
            })
          )}
        </ul>
      ) : null}
    </section>
  )
}
