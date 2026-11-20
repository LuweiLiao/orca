import type { AgentDetectionTarget } from '@/lib/agent-session/launch/inventory/useDetectedAgents'
import { callStructuredAgentSession } from '@/runtime/native-chat/requests/structured-agent-session-call'
import { toRuntimeWorktreeSelector } from '@/runtime/rpc/targets/runtime-worktree-selector'
import type { RuntimeClientTarget } from '../../../../../shared/remote-runtime/host-catalog/runtime-client-target'
import type {
  AgentSessionModelCatalogResult,
  AgentSessionOptionChoice
} from '../../../../../shared/agent-session/agent-session-wire'
import {
  discoverNativeChatCatalogModels,
  type NativeChatModelDiscoveryContext
} from '../session/options/catalog/native-chat-session-option-discovery'
import { readNativeChatEnrichedModels } from '../session/options/catalog/native-chat-session-option-enrichment'
import type { NativeChatStructuredComposerTransport } from '../composer/submit/native-chat-structured-composer-transport'

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
