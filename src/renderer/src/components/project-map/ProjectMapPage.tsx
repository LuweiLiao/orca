import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { subscribeToTerminalForkOrigins, terminalForkOrigins } from '@/lib/terminal-fork-origins'
import {
  projectMapClosedChats,
  subscribeToProjectMapClosedChats
} from '@/lib/project-map-closed-by-map'
import { projectMapHiddenKeys, subscribeToProjectMapHidden } from '@/lib/project-map-hidden'
import { GitBranch, Minus, Network, Plus, Scan, Search } from 'lucide-react'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { translate } from '@/i18n/i18n'
import { useLiveDashboardSnapshot } from '@/components/dashboard/useLiveDashboardSnapshot'
import { revealDashboardAgent } from '@/components/dashboard/reveal-dashboard-agent'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import {
  buildProjectMapGraph,
  listProjectMapProjects,
  type ProjectMapAgent,
  type ProjectMapWorkspace
} from './project-map-graph'
import { layoutProjectMap } from './project-map-layout'
import { projectMapChatRows, subscribeToProjectMapChatRows } from './project-map-chat-rows'
import { collapseProjectMapGraph } from './project-map-collapse'
import { reopenProjectMapChat } from './project-map-reopen'
import { projectMapAgentTitle } from './project-map-labels'
import { projectMapChatSessions, projectMapChatsByPaneKey } from './project-map-lineage'
import { projectMapAgentHasTab } from './project-map-node-actions'
import { useProjectMapLineage } from './use-project-map-lineage'
import { usePublishProjectMapSessionRelations } from './project-map-session-relations'
import { useProjectMapUndoKey } from './use-project-map-undo'
import { useProjectMapViewport } from './use-project-map-viewport'
import { ProjectMapCanvas } from './ProjectMapCanvas'
import { createFlowSignalBus } from './project-flow-signal'
import { useProjectFlowDispatchSignals } from './use-project-flow-dispatch-signals'
import { ProjectMapSummaryHost } from './ProjectMapSummaryHost'
import { GrowthTreePanel } from './GrowthTreePanel'
import { GrowthTreeJumpNotice } from './GrowthTreeJumpNotice'
import { useGrowthTreeJump } from './use-growth-tree-jump'
import { useProjectMapSummaryIndex } from './use-project-map-summary-index'
import './project-map.css'

const LINEAGE_REREAD_MS = 5000
const ALL_PROJECTS = '__all__'

export default function ProjectMapPage(): React.JSX.Element {
  const snapshot = useLiveDashboardSnapshot()
  const activeRepoId = useAppStore((s) => s.activeRepoId)
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const orchestration = useAppStore((s) => s.runtimeAgentOrchestrationByPaneKey)
  const [flowBus] = useState(createFlowSignalBus)
  useProjectFlowDispatchSignals(orchestration, flowBus)
  const sessions = useMemo(() => projectMapChatSessions(orchestration), [orchestration])
  const tabsByWorktree = useAppStore((s) => s.unifiedTabsByWorktree)
  const chats = useMemo(
    () => projectMapChatsByPaneKey(snapshot.cards, tabsByWorktree, sessions),
    [sessions, snapshot.cards, tabsByWorktree]
  )
  const [lineageRevision, setLineageRevision] = useState(0)
  const [searchOpen, setSearchOpen] = useState(false)
  // A sent message records its references, and a chat that has no card (a released worker) moves
  // no state the snapshot shows; so state changes re-read at once and a slow tick covers the rest.
  const terminalForks = useSyncExternalStore(subscribeToTerminalForkOrigins, terminalForkOrigins)
  const closedByMap = useSyncExternalStore(subscribeToProjectMapClosedChats, projectMapClosedChats)
  const hidden = useSyncExternalStore(subscribeToProjectMapHidden, projectMapHiddenKeys)
  useProjectMapUndoKey()
  const lastStateChange = useMemo(
    () => snapshot.cards.reduce((latest, card) => Math.max(latest, card.stateChangedAt), 0),
    [snapshot.cards]
  )
  useEffect(() => {
    const timer = window.setInterval(
      () => setLineageRevision((revision) => revision + 1),
      LINEAGE_REREAD_MS
    )
    return () => window.clearInterval(timer)
  }, [])
  const {
    entries: lineage,
    references,
    history,
    forkUnsupportedHosts
  } = useProjectMapLineage(chats, `${lineageRevision}:${lastStateChange}`)
  const projects = useMemo(() => listProjectMapProjects(snapshot), [snapshot])
  const [chosenProjectId, setChosenProjectId] = useState<string | null>(null)
  const [mapView, setMapView] = useState<'blueprint' | 'growth'>('blueprint')
  const growing = mapView === 'growth'
  const [sharedSelectedId, setSharedSelectedId] = useState<string | null>(null)
  const projectId =
    projects.find((project) => project.id === chosenProjectId)?.id ??
    projects.find((project) => project.id === activeRepoId)?.id ??
    projects.find((project) => project.agentCount > 0)?.id ??
    projects[0]?.id ??
    null
  const project = projects.find((candidate) => candidate.id === projectId) ?? null
  const forks = useMemo(
    () => ({
      chatsByPaneKey: chats,
      lineage,
      history,
      references,
      terminalForks,
      closedByMap,
      hidden,
      titleOf: projectMapAgentTitle
    }),
    [chats, closedByMap, hidden, history, lineage, references, terminalForks]
  )
  const graph = useMemo(
    () => (projectId ? buildProjectMapGraph(snapshot, projectId, sessions, forks) : null),
    [forks, projectId, sessions, snapshot]
  )
  const growthScope =
    chosenProjectId !== null && projects.some((candidate) => candidate.id === chosenProjectId)
      ? chosenProjectId
      : null
  const openBlueprintProject = useCallback((id: string) => {
    setChosenProjectId(id)
    setMapView('blueprint')
  }, [])
  const hasProject = useCallback(
    (id: string) => projects.some((candidate) => candidate.id === id),
    [projects]
  )
  const growthJump = useGrowthTreeJump({ graph, hasProject, openProject: openBlueprintProject })
  usePublishProjectMapSessionRelations(graph, lineage, references)
  useProjectMapSummaryIndex(graph)
  // Parents the person opened onto the canvas; the rest keep their delegated chats stacked.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const collapsed = useMemo(
    () => (graph ? collapseProjectMapGraph(graph, expanded) : null),
    [expanded, graph]
  )
  const chatRows = useSyncExternalStore(subscribeToProjectMapChatRows, projectMapChatRows)
  const layout = useMemo(
    () => (collapsed ? layoutProjectMap(collapsed.graph, chatRows) : null),
    [chatRows, collapsed]
  )
  const toggleCollapse = useCallback((parentPaneKey: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(parentPaneKey)) {
        next.add(parentPaneKey)
      }
      return next
    })
  }, [])
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
  const fittedProject = useRef<string | null>(null)
  useEffect(() => {
    if (viewportReady && projectId && !growing && fittedProject.current !== projectId) {
      fittedProject.current = projectId
      if (!growthJump.pending && !growthJump.locate) {
        fit()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [growing, projectId, viewportReady])

  const openAgent = useCallback((agent: ProjectMapAgent) => {
    // A closed chat, or a worker that never had a tab, has none to reveal; the host republishes
    // one from the chat's record.
    const tabless =
      agent.history ||
      (agent.chat &&
        !projectMapAgentHasTab(useAppStore.getState().unifiedTabsByWorktree, agent.card))
    if (tabless && agent.chat) {
      void reopenProjectMapChat(agent)
      return
    }
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

  // The map's own find; typing in a chat window or a field keeps the key for itself.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target
      if (
        growing ||
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== 'f' ||
        event.defaultPrevented ||
        (target instanceof Element &&
          (target.closest('[data-project-map-window]') ||
            target.closest('input, textarea, select, [contenteditable]')))
      ) {
        return
      }
      event.preventDefault()
      setSearchOpen(true)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [growing])

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
        <ToggleGroup
          type="single"
          value={mapView}
          onValueChange={(value) => {
            if (value === 'blueprint' || value === 'growth') {
              growthJump.clearLocate()
              setMapView(value)
            }
          }}
          variant="segmented"
          size="xs"
          aria-label={translate('growthTree.view.label', 'Map view')}
        >
          <ToggleGroupItem value="blueprint">
            <Network />
            {translate('growthTree.view.blueprint', 'Blueprint')}
          </ToggleGroupItem>
          <ToggleGroupItem value="growth">
            <GitBranch />
            {translate('growthTree.view.growth', 'Growth tree')}
          </ToggleGroupItem>
        </ToggleGroup>
        {projects.length > 0 ? (
          <Select
            value={growing ? (growthScope ?? ALL_PROJECTS) : (projectId ?? undefined)}
            onValueChange={(value) => setChosenProjectId(value === ALL_PROJECTS ? null : value)}
          >
            <SelectTrigger
              size="sm"
              className="min-w-36"
              aria-label={translate('projectMap.project', 'Project')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {growing ? (
                <SelectItem value={ALL_PROJECTS}>
                  {translate('growthTree.allProjects', 'All projects')}
                </SelectItem>
              ) : null}
              {projects.map((candidate) => (
                <SelectItem key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {project && !growing ? (
          <span className="truncate text-xs text-muted-foreground tabular-nums">
            {translate('projectMap.stats', '{{workspaces}} workspaces · {{agents}} conversations', {
              workspaces: project.workspaceCount,
              agents: project.agentCount
            })}
          </span>
        ) : null}
        <span className="flex-1" />
        <div className="flex items-center gap-0.5" hidden={growing}>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={translate('projectMap.search.open', 'Search the map')}
            aria-pressed={searchOpen}
            onClick={() => setSearchOpen((open) => !open)}
          >
            <Search className="size-3.5" />
          </Button>
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
      {growthJump.notice ? (
        <GrowthTreeJumpNotice
          notice={growthJump.notice}
          onUnhide={growthJump.unhide}
          onDismiss={growthJump.dismissNotice}
        />
      ) : null}
      <GrowthTreePanel
        active={growing}
        snapshot={snapshot}
        projects={projects}
        sessions={sessions}
        forks={forks}
        scopeProjectId={growthScope}
        selectedId={sharedSelectedId}
        onSelect={setSharedSelectedId}
        onJump={growthJump.jump}
        onOpenAgent={openAgent}
        onOpenWorkspace={openWorkspace}
        onRevealProject={() => setChosenProjectId(null)}
      />
      {growing ? null : graph && collapsed && layout ? (
        <ProjectMapCanvas
          graph={graph}
          collapsed={collapsed}
          layout={layout}
          flowBus={flowBus}
          viewport={viewport}
          activeWorktreeId={activeWorktreeId}
          onOpenAgent={openAgent}
          onOpenWorkspace={openWorkspace}
          forkUnsupportedHosts={forkUnsupportedHosts}
          onToggleCollapse={toggleCollapse}
          onForked={() => setLineageRevision((revision) => revision + 1)}
          searchOpen={searchOpen}
          onSearchOpenChange={setSearchOpen}
          initialSelectedId={sharedSelectedId}
          onSelectionChange={setSharedSelectedId}
          locateRequest={growthJump.locate}
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
      {graph ? <ProjectMapSummaryHost graph={graph} /> : null}
    </main>
  )
}
