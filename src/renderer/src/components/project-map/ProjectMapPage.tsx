import { useCallback, useEffect, useMemo, useState } from 'react'
import { Minus, Network, Plus, Scan } from 'lucide-react'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import { useLiveDashboardSnapshot } from '@/components/dashboard/useLiveDashboardSnapshot'
import { revealDashboardAgent } from '@/components/dashboard/reveal-dashboard-agent'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import {
  buildProjectMapGraph,
  listProjectMapProjects,
  projectMapChatOwners,
  type ProjectMapAgent,
  type ProjectMapWorkspace
} from './project-map-graph'
import { layoutProjectMap } from './project-map-layout'
import { useProjectMapViewport } from './use-project-map-viewport'
import { ProjectMapCanvas } from './ProjectMapCanvas'
import './project-map.css'

export default function ProjectMapPage(): React.JSX.Element {
  const snapshot = useLiveDashboardSnapshot()
  const activeRepoId = useAppStore((s) => s.activeRepoId)
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const orchestration = useAppStore((s) => s.runtimeAgentOrchestrationByPaneKey)
  const owners = useMemo(() => projectMapChatOwners(orchestration), [orchestration])
  const projects = useMemo(() => listProjectMapProjects(snapshot), [snapshot])
  const [chosenProjectId, setChosenProjectId] = useState<string | null>(null)
  const projectId =
    projects.find((project) => project.id === chosenProjectId)?.id ??
    projects.find((project) => project.id === activeRepoId)?.id ??
    projects.find((project) => project.agentCount > 0)?.id ??
    projects[0]?.id ??
    null
  const project = projects.find((candidate) => candidate.id === projectId) ?? null
  const graph = useMemo(
    () => (projectId ? buildProjectMapGraph(snapshot, projectId, owners) : null),
    [owners, projectId, snapshot]
  )
  const layout = useMemo(() => (graph ? layoutProjectMap(graph) : null), [graph])
  const contentWidth = layout?.width ?? 0
  const contentHeight = layout?.height ?? 0
  // Keyed by size so a status refresh with the same layout keeps a stable fit target.
  const contentSize = useMemo(
    () => (contentWidth > 0 ? { width: contentWidth, height: contentHeight } : null),
    [contentHeight, contentWidth]
  )
  const viewport = useProjectMapViewport(contentSize)
  const { fit } = viewport
  const viewportReady = viewport.size.width > 0
  // Fit once per project; later status refreshes keep the user's pan and zoom.
  useEffect(() => {
    if (viewportReady && projectId) {
      fit()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, viewportReady])

  const openAgent = useCallback((agent: ProjectMapAgent) => {
    revealDashboardAgent({
      repoId: agent.card.repoId,
      worktreeId: agent.card.worktreeId,
      executionHostId: agent.card.executionHostId,
      tabId: agent.card.tabId,
      leafId: agent.card.leafId
    })
  }, [])
  const openWorkspace = useCallback((workspace: ProjectMapWorkspace) => {
    activateAndRevealWorkspace(workspace.worktreeId, { executionHostId: workspace.executionHostId })
  }, [])

  return (
    <main className="project-map relative flex h-full min-h-0 flex-1 flex-col bg-background text-foreground">
      <header
        className="flex shrink-0 items-center gap-2.5 border-b border-border px-5 pt-5 pb-3"
        // Why: this page owns its header; keep it clear of Windows/Linux window controls.
        style={{ paddingRight: 'max(1.25rem, var(--window-controls-width, 0px))' }}
      >
        <h1 className="truncate text-base leading-8 font-semibold">
          {translate('projectMap.title', 'Project Map')}
        </h1>
        {projects.length > 0 ? (
          <Select value={projectId ?? undefined} onValueChange={setChosenProjectId}>
            <SelectTrigger
              size="sm"
              className="min-w-36"
              aria-label={translate('projectMap.project', 'Project')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {projects.map((candidate) => (
                <SelectItem key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {project ? (
          <span className="truncate text-xs text-muted-foreground tabular-nums">
            {translate('projectMap.stats', '{{workspaces}} workspaces · {{agents}} conversations', {
              workspaces: project.workspaceCount,
              agents: project.agentCount
            })}
          </span>
        ) : null}
        <span className="flex-1" />
        <div className="flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={translate('projectMap.zoomOut', 'Zoom out')}
            onClick={() => viewport.zoomBy(1 / 1.2)}
          >
            <Minus className="size-3.5" />
          </Button>
          <span className="w-11 text-center text-xs text-muted-foreground tabular-nums">
            {Math.round(viewport.view.zoom * 100)}%
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={translate('projectMap.zoomIn', 'Zoom in')}
            onClick={() => viewport.zoomBy(1.2)}
          >
            <Plus className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={translate('projectMap.fit', 'Fit to view')}
            onClick={fit}
          >
            <Scan className="size-3.5" />
          </Button>
        </div>
      </header>
      {graph && layout ? (
        <ProjectMapCanvas
          graph={graph}
          layout={layout}
          viewport={viewport}
          activeWorktreeId={activeWorktreeId}
          onOpenAgent={openAgent}
          onOpenWorkspace={openWorkspace}
        />
      ) : (
        <div
          ref={viewport.viewportRef}
          className="project-map-viewport flex min-h-0 flex-1 items-center justify-center"
        >
          <div className="flex max-w-80 flex-col items-center gap-2 text-center text-sm text-muted-foreground">
            <Network aria-hidden className="size-6" />
            {translate(
              'projectMap.empty',
              'Add a project to see its workspaces and conversations here.'
            )}
          </div>
        </div>
      )}
    </main>
  )
}
