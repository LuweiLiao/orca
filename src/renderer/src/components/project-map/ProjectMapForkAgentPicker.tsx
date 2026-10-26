import { useEffect, useMemo, useState } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { AgentIcon, getAgentCatalog } from '@/lib/agent-catalog'
import { chatProviderAgents, useHostStructuredAgentsVersion } from '@/lib/chat-provider-agents'
import { useDetectedAgents } from '@/hooks/useDetectedAgents'
import { structuredAgentSessionTargetForHost } from '@/runtime/structured-agent-session-owner'
import { filterEnabledTuiAgents } from '../../../../shared/tui-agent-selection'
import {
  discoverOrchestrationModels,
  type OrchestrationModel,
  type PickerHost
} from '@/components/native-chat/native-chat-orchestration-model-discovery'
import type { ProjectMapAgent } from './project-map-graph'

export type ProjectMapForkAgentChoice = { agent: string; model?: string; effort?: string }

const DEFAULT = '__default__'

/** The host that will run the child: the clicked chat's, in its workspace. */
function forkPickerHost(origin: ProjectMapAgent): PickerHost | null {
  const target = structuredAgentSessionTargetForHost(origin.chat?.executionHostId)
  if (!target) {
    return null
  }
  const worktreeId = origin.card.worktreeId
  return {
    target,
    preferHostCatalog: true,
    worktreeId,
    detection:
      target.kind === 'environment'
        ? { kind: 'runtime', environmentId: target.environmentId, worktreeId }
        : { kind: 'local', worktreeId }
  }
}

/** One agent with its model and effort, from the agents this host can run as a chat. */
export function ProjectMapForkAgentPicker({
  origin,
  choice,
  onChange
}: {
  origin: ProjectMapAgent
  choice: ProjectMapForkAgentChoice
  onChange: (choice: ProjectMapForkAgentChoice) => void
}): React.JSX.Element {
  const host = useMemo(() => forkPickerHost(origin), [origin])
  const inventory = useDetectedAgents(host?.detection)
  const disabledAgents = useAppStore((state) => state.settings?.disabledTuiAgents)
  const statuses = useAppStore((state) => state.runtimeStatusByEnvironmentId)
  useHostStructuredAgentsVersion()
  const chatAgents = new Set(
    origin.chat?.executionHostId ? chatProviderAgents(origin.chat.executionHostId, statuses) : []
  )
  const detected = new Set(filterEnabledTuiAgents(inventory.detectedIds ?? [], disabledAgents))
  const agents = getAgentCatalog().filter(
    (entry) => entry.id === choice.agent || (chatAgents.has(entry.id) && detected.has(entry.id))
  )
  const [models, setModels] = useState<OrchestrationModel[] | null>(null)

  useEffect(() => {
    if (!host) {
      return
    }
    let cancelled = false
    setModels(null)
    void discoverOrchestrationModels(host, choice.agent)
      .catch(() => [])
      .then((listed) => {
        if (!cancelled) {
          setModels(listed)
        }
      })
    return () => {
      cancelled = true
    }
  }, [choice.agent, host])

  const efforts = models?.find((model) => model.id === choice.model)?.efforts
  const trigger = 'w-full min-w-0'
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold text-muted-foreground">
        {translate('projectMap.fork.agent', 'Agent')}
      </span>
      <div className="grid grid-cols-2 gap-1.5">
        <Select value={choice.agent} onValueChange={(agent) => onChange({ agent })}>
          <SelectTrigger
            size="sm"
            className={trigger}
            aria-label={translate('projectMap.fork.agent', 'Agent')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {agents.map(({ id, label }) => (
              <SelectItem key={id} value={id}>
                <AgentIcon agent={id} size={14} />
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={choice.model ?? DEFAULT}
          onValueChange={(value) =>
            onChange({
              agent: choice.agent,
              ...(value === DEFAULT ? {} : { model: value })
            })
          }
        >
          <SelectTrigger
            size="sm"
            className={trigger}
            aria-label={translate('components.native-chat.composer.model', 'Model')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={DEFAULT}>
              {translate('components.native-chat.composer.defaultModel', 'Default model')}
            </SelectItem>
            {models === null ? (
              <SelectItem value="__loading__" disabled>
                {translate(
                  'components.native-chat.composer.loadingModels',
                  'Loading agent models…'
                )}
              </SelectItem>
            ) : null}
            {models?.map((model) => (
              <SelectItem key={model.id} value={model.id}>
                {model.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={choice.effort ?? DEFAULT}
          disabled={!choice.model || !efforts?.length}
          onValueChange={(value) =>
            onChange({
              ...choice,
              ...(value === DEFAULT ? { effort: undefined } : { effort: value })
            })
          }
        >
          <SelectTrigger
            size="sm"
            className={`${trigger} col-span-2`}
            aria-label={translate('components.native-chat.composer.effort', 'Effort')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={DEFAULT}>
              {translate('components.native-chat.composer.defaultEffort', 'Effort: default')}
            </SelectItem>
            {efforts?.map((effort) => (
              <SelectItem key={effort.value} value={effort.value}>
                {effort.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
