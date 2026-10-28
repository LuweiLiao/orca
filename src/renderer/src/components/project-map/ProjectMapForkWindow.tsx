import type { ProjectMapAgent } from './project-map-graph'
import type { ProjectMapForkAt } from './project-map-fork-sources'
import type { ProjectMapRect } from './project-map-window-placement'
import { ProjectMapForkPanel } from './ProjectMapForkPanel'
import { ProjectMapMergePanel } from './ProjectMapMergePanel'

/** The chat a new child is being made from: one chat, a turn on its timeline, or a merge. */
export type ProjectMapForkIntent = {
  paneKey: string
  at?: ProjectMapForkAt
  /** A merge: the other picked chats, after `paneKey`. */
  merge?: readonly string[]
}

type Props = {
  intent: ProjectMapForkIntent
  origin: ProjectMapAgent
  agents: ReadonlyMap<string, ProjectMapAgent>
  anchor: ProjectMapRect
  viewport: { width: number; height: number }
  avoid: ProjectMapRect[]
  onClose: () => void
  onCreated: (child: { sessionId: string; tabId?: string }) => void
}

/** The panel for a new child: the fork panel for one chat, the merge panel for several. */
export function ProjectMapForkWindow({
  intent,
  origin,
  agents,
  ...panel
}: Props): React.JSX.Element {
  const others = (intent.merge ?? []).flatMap((paneKey) => agents.get(paneKey) ?? [])
  return others.length > 0 ? (
    <ProjectMapMergePanel chats={[origin, ...others]} {...panel} />
  ) : (
    <ProjectMapForkPanel
      origin={origin}
      agents={agents}
      {...(intent.at ? { at: intent.at } : {})}
      {...panel}
    />
  )
}
