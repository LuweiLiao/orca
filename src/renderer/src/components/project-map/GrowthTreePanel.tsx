import { useEffect, useMemo, useState } from 'react'
import type { OrchestrationChatSession } from '../../../../shared/agent-status-types'
import type { DashboardSnapshot } from '../../../../shared/dashboard-snapshot'
import { buildGrowthTree } from './growth-tree-build'
import type { GrowthTreePathIndex } from './growth-tree-layout'
import type { FlowSignalBus } from './project-flow-signal'
import type { GrowthTree } from './growth-tree-types'
import { GrowthTreeView, type GrowthTreeJumpTarget } from './GrowthTreeView'
import type {
  ProjectMapAgent,
  ProjectMapForkInput,
  ProjectMapProject,
  ProjectMapWorkspace
} from './project-map-graph'

const NOW_TICK_MS = 30_000

function useNow(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) {
      return
    }
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), NOW_TICK_MS)
    return () => window.clearInterval(timer)
  }, [enabled])
  return now
}

type Props = {
  active: boolean
  snapshot: DashboardSnapshot
  projects: readonly ProjectMapProject[]
  sessions: ReadonlyMap<string, OrchestrationChatSession>
  forks: ProjectMapForkInput
  /** One project, or null for all. */
  scopeProjectId: string | null
  selectedId: string | null
  onSelect: (id: string | null) => void
  onJump: (target: GrowthTreeJumpTarget) => void
  onOpenAgent: (agent: ProjectMapAgent) => void
  onOpenWorkspace: (workspace: ProjectMapWorkspace) => void
  onRevealProject: (projectId: string) => void
  bus: FlowSignalBus
  renderOverlay?: (paths: GrowthTreePathIndex) => React.ReactNode
}

/** Builds the tree only while shown; hidden, it keeps the last one and its pan, zoom and filters. */
export function GrowthTreePanel({
  active,
  snapshot,
  projects,
  sessions,
  forks,
  scopeProjectId,
  ...view
}: Props): React.JSX.Element | null {
  const now = useNow(active)
  const built = useMemo(
    () => (active ? buildGrowthTree({ snapshot, projects, sessions, forks, now }) : null),
    [active, forks, now, projects, sessions, snapshot]
  )
  const [tree, setTree] = useState<GrowthTree | null>(null)
  if (built && built !== tree) {
    setTree(built)
  }
  const projectIds = useMemo(
    () => (scopeProjectId ? new Set([scopeProjectId]) : null),
    [scopeProjectId]
  )
  const projectNames = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects]
  )
  if (!tree) {
    return null
  }
  const { onOpenAgent, onOpenWorkspace, ...rest } = view
  return (
    <GrowthTreeView
      {...rest}
      tree={tree}
      active={active}
      projectIds={projectIds}
      projectNames={projectNames}
      onOpenBar={(bar) => onOpenAgent(bar.agent)}
      onOpenLane={(lane) => onOpenWorkspace(lane.workspace)}
    />
  )
}
