import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { growthDateTime, growthKindLabel } from './growth-tree-labels'
import type { GrowthTree, GrowthTreeBar, GrowthTreeLane } from './growth-tree-types'
import { projectMapStateLabel } from './project-map-labels'

type Props = {
  tree: GrowthTree
  selectedId: string
  projectNames: ReadonlyMap<string, string>
  onClose: () => void
  onLocate: (id: string) => void
  onOpenBar: (bar: GrowthTreeBar) => void
  onOpenLane: (lane: GrowthTreeLane) => void
}

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-2xs text-muted-foreground">{label}</dt>
      <dd className="text-xs break-words">{children}</dd>
    </div>
  )
}

/** The page-docked panel for the selected chat or workspace; it never covers the tree. */
export function GrowthTreeDock({
  tree,
  selectedId,
  projectNames,
  onClose,
  onLocate,
  onOpenBar,
  onOpenLane
}: Props): React.JSX.Element | null {
  const bar = tree.bars.get(selectedId)
  const lane = tree.lanes.get(selectedId)
  const subject = bar ?? lane
  if (!subject) {
    return null
  }
  const title = bar ? bar.title : lane!.name
  const relations = [...tree.edges, ...tree.crossLinks].filter(
    (relation) => relation.from === selectedId || relation.to === selectedId
  )
  return (
    <aside
      data-growth-dock=""
      aria-label={translate('growthTree.dock.label', 'Selection details')}
      className="flex w-72 shrink-0 flex-col border-l border-border bg-background max-[900px]:absolute max-[900px]:inset-y-0 max-[900px]:right-0 max-[900px]:z-10 max-[900px]:shadow-md"
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{title}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={translate('growthTree.dock.close', 'Close details')}
          onClick={onClose}
        >
          <X className="size-3.5" />
        </Button>
      </div>
      <dl className="scrollbar-sleek flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {bar ? (
          <>
            <Row label={translate('growthTree.dock.status', 'Status')}>
              {bar.history
                ? translate('growthTree.dock.closed', 'Closed')
                : projectMapStateLabel(bar.state)}
            </Row>
            <Row label={translate('growthTree.dock.time', 'Time')}>
              {growthDateTime(bar.start)} →{' '}
              {bar.running ? translate('growthTree.dock.now', 'now') : growthDateTime(bar.end)}
              {bar.startApprox
                ? ` (${translate('growthTree.dock.approx', 'start estimated')})`
                : null}
            </Row>
            <Row label={translate('growthTree.dock.workspace', 'Workspace')}>
              {tree.lanes.get(bar.workspaceId)?.name ?? bar.workspaceId}
            </Row>
          </>
        ) : (
          <>
            <Row label={translate('growthTree.dock.kind', 'Kind')}>
              {lane!.kind === 'folder'
                ? translate('growthTree.folderWorkspace', 'Folder workspace')
                : translate('growthTree.worktree', 'Worktree')}
            </Row>
            <Row label={translate('growthTree.dock.chats', 'Conversations')}>
              {lane!.barIds.length}
            </Row>
          </>
        )}
        <Row label={translate('growthTree.dock.project', 'Project')}>
          {projectNames.get(subject.projectId) ?? subject.projectId}
        </Row>
        {relations.length > 0 ? (
          <Row label={translate('growthTree.dock.relations', 'Relations')}>
            <ul className="flex flex-col gap-0.5">
              {relations.map((relation) => {
                const other = relation.from === selectedId ? relation.to : relation.from
                const name = tree.bars.get(other)?.title ?? tree.lanes.get(other)?.name ?? other
                return (
                  <li key={relation.id} className="truncate">
                    {growthKindLabel(relation.kind)}
                    {relation.from === selectedId ? ' → ' : ' ← '}
                    {name}
                  </li>
                )
              })}
            </ul>
          </Row>
        ) : null}
        {bar?.hiddenInBlueprint ? (
          <p className="text-2xs text-muted-foreground">
            {translate('growthTree.dock.hidden', 'Hidden in the blueprint.')}
          </p>
        ) : null}
      </dl>
      <div className="flex flex-col gap-1.5 border-t border-border p-3">
        <Button type="button" size="sm" onClick={() => onLocate(selectedId)}>
          {translate('growthTree.dock.locate', 'Locate in blueprint')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => (bar ? onOpenBar(bar) : onOpenLane(lane!))}
        >
          {bar
            ? translate('growthTree.dock.openChat', 'Open conversation')
            : translate('growthTree.dock.openWorkspace', 'Open workspace')}
        </Button>
        {bar ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onOpenLane(tree.lanes.get(bar.workspaceId)!)}
          >
            {translate('growthTree.dock.openWorkspace', 'Open workspace')}
          </Button>
        ) : null}
      </div>
    </aside>
  )
}
