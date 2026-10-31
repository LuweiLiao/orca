import type { AgentDetectionTarget } from '@/hooks/useDetectedAgents'
import { callStructuredAgentSession } from '@/runtime/structured-agent-session-client'
import { toRuntimeWorktreeSelector } from '@/runtime/runtime-worktree-selector'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type {
  AgentSessionModelCatalogResult,
  AgentSessionOptionChoice
} from '../../../../shared/agent-session-wire'
import {
  discoverNativeChatCatalogModels,
  type NativeChatModelDiscoveryContext
} from './native-chat-session-option-discovery'
import { readNativeChatEnrichedModels } from './native-chat-session-option-enrichment'
import type { NativeChatStructuredComposerTransport } from './native-chat-composer-types'

export type PickerTransport = Pick<
  NativeChatStructuredComposerTransport,
  'runtimeEnvironmentId' | 'worktreeId'
>

export type PickerHost = {
  target: RuntimeClientTarget
  detection: AgentDetectionTarget
  discovery?: NativeChatModelDiscoveryContext
  preferHostCatalog: boolean
  worktreeId?: string
}

export type OrchestrationModel = {
  id: string
  label: string
  efforts?: AgentSessionOptionChoice[]
}

export async function discoverOrchestrationModels(
  host: PickerHost,
  agent: string
): Promise<OrchestrationModel[]> {
  if (host.preferHostCatalog && agent !== 'ccb') {
    const params = {
      agent,
      ...(host.worktreeId ? { worktree: toRuntimeWorktreeSelector(host.worktreeId) } : {})
    }
    try {
      let catalog = await callStructuredAgentSession<AgentSessionModelCatalogResult>(
        host.target,
        'agentSession.modelCatalog',
        params
      )
      if (catalog.listingInProgress) {
        catalog = await callStructuredAgentSession<AgentSessionModelCatalogResult>(
          host.target,
          'agentSession.modelCatalog',
          { ...params, waitForListing: true }
        )
      }
      if (catalog.origin !== 'unknown' && catalog.models.length > 0) {
        return catalog.models.map(({ id, label, efforts, effortsKnown }) => ({
          id,
          label,
          ...(effortsKnown !== false && efforts ? { efforts } : {})
        }))
      }
    } catch {
      // An older host or an agent without a structured catalog can still use CLI discovery.
    }
  }
  if (!host.discovery) {
    return []
  }
  const { runtime, hostKey } = host.discovery
  const cached = readNativeChatEnrichedModels(agent, hostKey)
  const catalog = cached ?? (await discoverNativeChatCatalogModels(agent, runtime, hostKey))
  return (
    catalog?.map(({ id, label, options }) => {
      const effort = options?.find((option) => option.id === 'effort')
      return {
        id,
        label,
        ...(effort?.kind.type === 'select' ? { efforts: effort.kind.choices } : {})
      }
    }) ?? []
  )
}
