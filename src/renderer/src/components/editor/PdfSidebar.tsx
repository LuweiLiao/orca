import { type JSX, useState } from 'react'
import type * as pdfjsLib from 'pdfjs-dist'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { translate } from '@/i18n/i18n'
import { readFileViewPreference, writeFileViewPreference } from './file-view-preference-storage'
import { PdfOutlineTree, usePdfOutline } from './PdfOutlineTree'
import { PdfThumbnails } from './PdfThumbnails'

export const PDF_SIDEBAR_STORAGE_KEY = 'orca.pdf.sidebar.v1'

export type PdfSidebarTab = 'outline' | 'pages'
export type PdfSidebarPreference = { open: boolean; tab: PdfSidebarTab | null }

export function readPdfSidebarPreference(preferenceKey: string | null): PdfSidebarPreference {
  const value = preferenceKey
    ? readFileViewPreference(PDF_SIDEBAR_STORAGE_KEY, preferenceKey)
    : undefined
  if (typeof value !== 'object' || value === null) {
    return { open: false, tab: null }
  }
  const open: unknown = Reflect.get(value, 'open')
  const tab: unknown = Reflect.get(value, 'tab')
  return { open: open === true, tab: tab === 'outline' || tab === 'pages' ? tab : null }
}

export function writePdfSidebarPreference(
  preferenceKey: string | null,
  preference: PdfSidebarPreference
): void {
  if (preferenceKey) {
    writeFileViewPreference(PDF_SIDEBAR_STORAGE_KEY, preferenceKey, preference)
  }
}

/** The outline and page thumbnails beside a PDF; a PDF without an outline opens on its pages. */
export function PdfSidebar({
  doc,
  currentPage,
  tab,
  onTabChange,
  onGoToPage,
  onGoToDestination
}: {
  doc: pdfjsLib.PDFDocumentProxy
  currentPage: number
  tab: PdfSidebarTab | null
  onTabChange: (tab: PdfSidebarTab) => void
  onGoToPage: (pageNumber: number) => void
  onGoToDestination: (dest: string | unknown[]) => void
}): JSX.Element {
  const outline = usePdfOutline(doc)
  const [chosen, setChosen] = useState(tab)
  const shown: PdfSidebarTab = chosen ?? (outline.rows?.length ? 'outline' : 'pages')
  return (
    <aside
      data-pdf-sidebar=""
      aria-label={translate('auto.components.editor.PdfViewer.sidebar', 'PDF navigation')}
      className="flex w-56 shrink-0 flex-col border-r bg-background"
    >
      <Tabs
        value={shown}
        onValueChange={(value) => {
          const next: PdfSidebarTab = value === 'outline' ? 'outline' : 'pages'
          setChosen(next)
          onTabChange(next)
        }}
        className="min-h-0 flex-1"
      >
        <div className="border-b px-2 py-1.5">
          <TabsList size="sm" className="w-full">
            <TabsTrigger value="outline">
              {translate('auto.components.editor.PdfViewer.outlineTab', 'Outline')}
            </TabsTrigger>
            <TabsTrigger value="pages">
              {translate('auto.components.editor.PdfViewer.pagesTab', 'Pages')}
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="outline" className="min-h-0">
          <div className="h-full overflow-y-auto scrollbar-sleek">
            {outline.rows ? (
              <PdfOutlineTree
                rows={outline.rows}
                pageOf={outline.pageOf}
                currentPage={currentPage}
                onNavigate={onGoToDestination}
              />
            ) : null}
          </div>
        </TabsContent>
        <TabsContent value="pages" className="min-h-0">
          <PdfThumbnails doc={doc} currentPage={currentPage} onNavigate={onGoToPage} />
        </TabsContent>
      </Tabs>
    </aside>
  )
}
