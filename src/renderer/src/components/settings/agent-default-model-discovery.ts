import type { AgentDetectionTarget } from '@/hooks/useDetectedAgents'
import { useAppStore } from '@/store'
import { runtimeTargetForWorkspaceOwner } from '@/lib/resolve-owner'
import { getConnectionIdFromState } from '@/lib/connection-context'
import { discoveryContextForTransport } from '../native-chat/native-chat-session-option-discovery'
import type { PickerHost } from '../native-chat/native-chat-orchestration-model-discovery'

export function agentDefaultModelDiscoveryHost(detection: AgentDetectionTarget): PickerHost {
  const state = useAppStore.getState()
  const target =
    detection.kind === 'runtime'
      ? { kind: 'environment' as const, environmentId: detection.environmentId }
      : { kind: 'local' as const }
  const candidate =
    detection.kind !== 'ssh' && detection.worktreeId ? detection.worktreeId : state.activeWorktreeId
  const owner = candidate ? runtimeTargetForWorkspaceOwner(state, { workspaceId: candidate }) : null
  const connection = getConnectionIdFromState(state, candidate)
  const sameOwner =
    owner?.kind === target.kind &&
    (owner.kind !== 'environment' ||
      (target.kind === 'environment' && owner.environmentId === target.environmentId))
  const sameConnection =
    detection.kind === 'ssh' ? connection === detection.connectionId : !connection
  const worktreeId = candidate && sameOwner && sameConnection ? candidate : undefined
  const discovery = discoveryContextForTransport(
    target,
    worktreeId ?? null,
    detection.kind === 'ssh' ? detection.connectionId : null,
    null
  )
  return { target, detection, preferHostCatalog: detection.kind !== 'ssh', worktreeId, discovery }
}
