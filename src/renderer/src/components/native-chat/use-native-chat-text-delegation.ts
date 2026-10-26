import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppStore } from '@/store'
import { getAgentCatalog } from '@/lib/agent-catalog'
import { useDetectedAgents } from '@/hooks/useDetectedAgents'
import { filterEnabledTuiAgents } from '../../../../shared/tui-agent-selection'
import { parseAgentDelegationTextRequest } from '../../../../shared/agent-delegation-text-request'
import { agentDelegationProviderNames } from '../../../../shared/agent-delegation-text-vocabulary'
import {
  agentDelegationCatalogAgents,
  agentDelegationTextSignature,
  resolveAgentDelegationText,
  type AgentDelegationCatalogModel,
  type AgentDelegationCatalogs,
  type AgentDelegationTextResolution
} from '../../../../shared/agent-delegation-text-resolution'
import type { NativeChatStructuredComposerTransport } from './native-chat-composer-types'
import { pickerHost } from './NativeChatOrchestrationPicker'
import {
  discoverOrchestrationModels,
  type PickerHost
} from './native-chat-orchestration-model-discovery'
import {
  dismissNativeChatTextDelegation,
  forgetNativeChatTextDelegationDismissal,
  hideNativeChatTextDelegation,
  showNativeChatTextDelegation,
  useNativeChatTextDelegationDismissal
} from './native-chat-text-delegation-store'

const NO_CATALOGS: AgentDelegationCatalogs = {}

type HostCatalogs = {
  hostKey: string
  models: Record<string, AgentDelegationCatalogModel[] | null>
}

function pickerHostKey(host: PickerHost): string {
  return JSON.stringify([host.target, host.detection, host.worktreeId, host.discovery?.hostKey])
}

/**
 * Agents the draft asks for in words ("创建2个claudeopus5.5和2个codex 6.1sol分析下"), resolved
 * against the agents and models this chat's host offers, as the composer's picker lists them.
 * Ready cards are what a send of this exact draft carries, unless the person dismissed them.
 */
export function useNativeChatTextDelegation(args: {
  draftScopeKey: string
  draft: string
  terminalTabId: string
  structuredTransport?: NativeChatStructuredComposerTransport
  enabled: boolean
}): { resolution: AgentDelegationTextResolution; dismiss: () => void } {
  const { draftScopeKey, draft, terminalTabId, structuredTransport, enabled } = args
  const catalog = getAgentCatalog()
  const { names, labels } = useMemo(
    () => ({
      names: agentDelegationProviderNames(catalog),
      labels: new Map<string, string>(catalog.map((entry) => [entry.id, entry.label]))
    }),
    [catalog]
  )
  const groups = useMemo(() => parseAgentDelegationTextRequest(draft, names), [draft, names])
  const signature = agentDelegationTextSignature(groups)
  const dismissed = useNativeChatTextDelegationDismissal(draftScopeKey)
  const active = enabled && signature !== null && dismissed !== signature

  const runtimeEnvironmentId = structuredTransport?.runtimeEnvironmentId
  const worktreeId = structuredTransport?.worktreeId
  const hasTransport = structuredTransport !== undefined
  const host = useMemo(
    () =>
      active
        ? pickerHost(
            terminalTabId,
            hasTransport
              ? { runtimeEnvironmentId: runtimeEnvironmentId ?? null, worktreeId }
              : undefined
          )
        : null,
    [active, terminalTabId, hasTransport, runtimeEnvironmentId, worktreeId]
  )
  const inventory = useDetectedAgents(host ? host.detection : undefined)
  const disabledAgents = useAppStore((state) => state.settings?.disabledTuiAgents)
  const { detectedIds, detectionFailed } = inventory
  const available = useMemo(() => {
    if (!active) {
      return null
    }
    if (!host || detectionFailed) {
      return new Set<string>()
    }
    return detectedIds ? new Set<string>(filterEnabledTuiAgents(detectedIds, disabledAgents)) : null
  }, [active, host, detectionFailed, detectedIds, disabledAgents])

  const [catalogs, setCatalogs] = useState<HostCatalogs | null>(null)
  const hostKey = host ? pickerHostKey(host) : null
  const models = catalogs && catalogs.hostKey === hostKey ? catalogs.models : null
  const wanted = agentDelegationCatalogAgents(groups, available).join('\n')
  useEffect(() => {
    if (!host || !hostKey || !wanted) {
      return
    }
    const missing = wanted.split('\n').filter((agent) => !models || !Object.hasOwn(models, agent))
    if (missing.length === 0) {
      return
    }
    const loading = Object.fromEntries(missing.map((agent) => [agent, null]))
    // A list that landed since this render must not be put back to loading.
    setCatalogs((current) => ({
      hostKey,
      models: { ...loading, ...(current?.hostKey === hostKey ? current.models : {}) }
    }))
    for (const agent of missing) {
      void discoverOrchestrationModels(host, agent)
        .catch(() => [])
        .then((listed) =>
          setCatalogs((current) =>
            current?.hostKey === hostKey
              ? { hostKey, models: { ...current.models, [agent]: listed } }
              : current
          )
        )
    }
  }, [host, hostKey, models, wanted])

  const resolution = useMemo(
    () =>
      active
        ? resolveAgentDelegationText(
            groups,
            available,
            (agent) => labels.get(agent) ?? agent,
            models ?? NO_CATALOGS
          )
        : ({ kind: 'none' } as const),
    [active, groups, available, labels, models]
  )

  useEffect(() => {
    if (signature === null) {
      forgetNativeChatTextDelegationDismissal(draftScopeKey)
    }
  }, [draftScopeKey, signature])

  const [owner] = useState(() => ({}))
  const cards = resolution.kind === 'ready' ? resolution.cards : null
  useEffect(() => {
    if (!cards) {
      return
    }
    showNativeChatTextDelegation(draftScopeKey, { owner, typed: draft, cards })
    return () => hideNativeChatTextDelegation(draftScopeKey, owner)
  }, [cards, draft, draftScopeKey, owner])

  const dismiss = useCallback(() => {
    if (signature) {
      dismissNativeChatTextDelegation(draftScopeKey, signature)
    }
  }, [draftScopeKey, signature])
  return { resolution, dismiss }
}
