import { type JSX, useState } from 'react'
import { ChevronDown, PanelLeft, Search, ZoomIn, ZoomOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { useShortcutKeyDetails } from '@/hooks/useShortcutLabel'
import { translate } from '@/i18n/i18n'
import type { PdfScalePreference } from './pdf-scale-preference'
import { ViewerToolbarButton } from './ViewerToolbarButton'

type Props = {
  sidebarOpen: boolean
  onToggleSidebar: () => void
  filename: string
  scale: number
  scaleBounds: { min: number; max: number }
  page: { number: number; count: number } | null
  onZoom: (direction: 'in' | 'out') => void
  onScalePreference: (preference: PdfScalePreference) => void
  onGoToPage: (pageNumber: number) => void
  onFind: () => void
}

/** The PDF viewer's footer: zoom, the page it is on and a box to jump to another, and find. */
export function PdfToolbar({
  sidebarOpen,
  onToggleSidebar,
  filename,
  scale,
  scaleBounds,
  page,
  onZoom,
  onScalePreference,
  onGoToPage,
  onFind
}: Props): JSX.Element {
  const findShortcut = useShortcutKeyDetails('editor.find')
  const zoomInShortcut = useShortcutKeyDetails('zoom.in')
  const zoomOutShortcut = useShortcutKeyDetails('zoom.out')
  const scaleModes: { preference: PdfScalePreference; label: string }[] = [
    {
      preference: 'page-width',
      label: translate('auto.components.editor.PdfViewer.c0119616d6', 'Fit to width')
    },
    {
      preference: 'page-fit',
      label: translate('auto.components.editor.PdfViewer.fitPage', 'Fit page')
    },
    {
      preference: 1,
      label: translate('auto.components.editor.PdfViewer.actualSize', 'Actual size')
    }
  ]
  return (
    <div className="flex items-center gap-3 border-t px-3 py-1 text-xs text-muted-foreground">
      <ViewerToolbarButton
        label={
          sidebarOpen
            ? translate('auto.components.editor.PdfViewer.hideSidebar', 'Hide outline and pages')
            : translate('auto.components.editor.PdfViewer.showSidebar', 'Show outline and pages')
        }
        pressed={sidebarOpen}
        onClick={onToggleSidebar}
      >
        <PanelLeft />
      </ViewerToolbarButton>
      <div className="flex items-center gap-0.5">
        <ViewerToolbarButton
          label={translate('auto.components.editor.PdfViewer.fa5d096b00', 'Zoom out')}
          shortcut={zoomOutShortcut}
          disabled={scale <= scaleBounds.min}
          onClick={() => onZoom('out')}
        >
          <ZoomOut />
        </ViewerToolbarButton>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              aria-label={translate('auto.components.editor.PdfViewer.zoomLevel', 'Zoom level')}
            >
              <span className="flex items-center gap-0.5 tabular-nums">
                {Math.round(scale * 100)}%
                <ChevronDown className="size-3" />
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top">
            {scaleModes.map((mode) => (
              <DropdownMenuItem
                key={String(mode.preference)}
                onSelect={() => onScalePreference(mode.preference)}
              >
                {mode.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <ViewerToolbarButton
          label={translate('auto.components.editor.PdfViewer.2b6eb1ccd6', 'Zoom in')}
          shortcut={zoomInShortcut}
          disabled={scale >= scaleBounds.max}
          onClick={() => onZoom('in')}
        >
          <ZoomIn />
        </ViewerToolbarButton>
      </div>
      {page ? <PdfPageBox key={page.number} page={page} onGoToPage={onGoToPage} /> : null}
      <ViewerToolbarButton
        label={translate('auto.components.editor.PdfViewer.findInPdf', 'Find in PDF')}
        shortcut={findShortcut}
        onClick={onFind}
      >
        <Search />
      </ViewerToolbarButton>
      <span className="min-w-0 truncate" title={filename}>
        {filename}
      </span>
    </div>
  )
}

/** The page number as an editable box: Enter or leaving it jumps, Escape puts it back. */
function PdfPageBox({
  page,
  onGoToPage
}: {
  page: { number: number; count: number }
  onGoToPage: (pageNumber: number) => void
}): JSX.Element {
  const [draft, setDraft] = useState(String(page.number))
  const commit = (): void => {
    const wanted = Number.parseInt(draft, 10)
    if (!Number.isFinite(wanted)) {
      setDraft(String(page.number))
      return
    }
    const clamped = Math.min(Math.max(wanted, 1), page.count)
    setDraft(String(clamped))
    if (clamped !== page.number) {
      onGoToPage(clamped)
    }
  }
  return (
    <label className="flex items-center gap-1 tabular-nums">
      <Input
        value={draft}
        inputMode="numeric"
        aria-label={translate('auto.components.editor.PdfViewer.pageNumber', 'Page number')}
        data-pdf-page-input=""
        density="compact"
        className="w-12 text-center"
        onChange={(event) => setDraft(event.target.value.replace(/[^\d]/g, ''))}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            setDraft(String(page.number))
          }
        }}
      />
      <span>
        {translate('auto.components.editor.PdfViewer.pageCount', 'of {{count}}', {
          count: page.count
        })}
      </span>
    </label>
  )
}
