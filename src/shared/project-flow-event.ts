export const PROJECT_FLOW_RUNTIME_CAPABILITY = 'orchestration.project-flow.v1' as const

export const PROJECT_FLOW_KINDS = ['delegate', 'report', 'handoff', 'merge-ready', 'merge'] as const
export type ProjectFlowKind = (typeof PROJECT_FLOW_KINDS)[number]

/** Where a flight starts or ends; a viewer resolves it with what it already knows. */
export type ProjectFlowEndpoint =
  | { kind: 'worker'; dispatchId: string }
  | { kind: 'coordinator'; dispatchId: string }
  | { kind: 'pane'; paneKey: string }
  | { kind: 'session'; sessionId: string }
  | { kind: 'workspace'; workspaceId: string }
  /** The workspace whose branch this PR merges. */
  | { kind: 'pull-request'; repoId: string; prNumber: number }
  /** The workspace the PR merged into: the parent of the one above. */
  | { kind: 'pull-request-base'; repoId: string; prNumber: number }

/** Ids and ends only: never a task body or a report body. */
export type ProjectFlowEvent = {
  type: 'projectFlow'
  /** Equal ids are one occurrence; a viewer that sees one twice draws it once. */
  id: string
  flow: ProjectFlowKind
  /** Reports only. */
  outcome?: 'succeeded' | 'failed'
  from: ProjectFlowEndpoint
  to: ProjectFlowEndpoint
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function parseProjectFlowEndpoint(value: unknown): ProjectFlowEndpoint | null {
  if (!isRecord(value)) {
    return null
  }
  const text = (key: string): string | null => {
    const field = value[key]
    return typeof field === 'string' && field.length > 0 ? field : null
  }
  switch (value.kind) {
    case 'worker':
    case 'coordinator': {
      const dispatchId = text('dispatchId')
      return dispatchId ? { kind: value.kind, dispatchId } : null
    }
    case 'pane': {
      const paneKey = text('paneKey')
      return paneKey ? { kind: 'pane', paneKey } : null
    }
    case 'session': {
      const sessionId = text('sessionId')
      return sessionId ? { kind: 'session', sessionId } : null
    }
    case 'workspace': {
      const workspaceId = text('workspaceId')
      return workspaceId ? { kind: 'workspace', workspaceId } : null
    }
    case 'pull-request':
    case 'pull-request-base': {
      const repoId = text('repoId')
      const prNumber = value.prNumber
      return repoId && typeof prNumber === 'number' && Number.isInteger(prNumber)
        ? { kind: value.kind, repoId, prNumber }
        : null
    }
    default:
      return null
  }
}

/** A host's event is untrusted input: anything that is not exactly this shape is dropped. */
export function parseProjectFlowEvent(value: unknown): ProjectFlowEvent | null {
  if (!isRecord(value) || value.type !== 'projectFlow') {
    return null
  }
  const { id, flow, outcome } = value
  const kind = PROJECT_FLOW_KINDS.find((candidate) => candidate === flow)
  const from = parseProjectFlowEndpoint(value.from)
  const to = parseProjectFlowEndpoint(value.to)
  if (typeof id !== 'string' || id.length === 0 || !kind || !from || !to) {
    return null
  }
  if (outcome !== undefined && outcome !== 'succeeded' && outcome !== 'failed') {
    return null
  }
  return {
    type: 'projectFlow',
    id,
    flow: kind,
    ...(outcome ? { outcome } : {}),
    from,
    to
  }
}
