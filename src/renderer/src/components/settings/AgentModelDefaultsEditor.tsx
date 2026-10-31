import { useEffect, useMemo, useState } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { AgentDetectionTarget } from '@/hooks/useDetectedAgents'
import type { TuiAgent } from '../../../../shared/tui-agent'
import type {
  AgentModelOptionChoices,
  AgentChoicePatch
} from '../../../../shared/agent-launch-choices'
import { getAgentSessionOptionLaunchCatalog } from '../../../../shared/agent-session-option-catalog'
import {
  discoverOrchestrationModels,
  type OrchestrationModel
} from '../native-chat/native-chat-orchestration-model-discovery'
import { agentDefaultModelDiscoveryHost } from './agent-default-model-discovery'
import { translate } from '@/i18n/i18n'

const DEFAULT = '__agent_default__'

export function AgentModelDefaultsEditor({
  agent,
  value,
  detection,
  onSave
}: {
  agent: TuiAgent
  value: AgentModelOptionChoices | undefined
  detection: AgentDetectionTarget
  onSave: (patch: AgentChoicePatch) => Promise<void>
}): React.JSX.Element | null {
  const host = useMemo(() => agentDefaultModelDiscoveryHost(detection), [detection])
  const [requested, setRequested] = useState(false)
  const [models, setModels] = useState<OrchestrationModel[] | null>(null)
  const [saving, setSaving] = useState(false)
  const catalog = getAgentSessionOptionLaunchCatalog(agent)
  useEffect(() => {
    if (!requested) {
      return
    }
    let active = true
    setModels(null)
    void discoverOrchestrationModels(host, agent).then(
      (listed) => {
        if (active) {
          setModels(listed)
        }
      },
      () => {
        if (active) {
          setModels([])
        }
      }
    )
    return () => {
      active = false
    }
  }, [agent, host, requested])
  if (!catalog) {
    return null
  }
  const listed = models ?? []
  const modelId = value?.model
  const seedOptions =
    (modelId ? catalog.models.find((model) => model.id === modelId)?.options : null) ??
    catalog.unknownModelOptions ??
    []
  const effort = seedOptions.find((option) => option.id === 'effort')
  const efforts =
    listed.find((model) => model.id === modelId)?.efforts ??
    (agent !== 'ccb' && effort?.kind.type === 'select' ? effort.kind.choices : [])
  const defaultLabel = translate('settings.agents.modelDefault', 'Agent default')
  const save = (patch: AgentChoicePatch): void => {
    setSaving(true)
    void onSave(patch)
      .catch(() => {})
      .finally(() => setSaving(false))
  }
  return (
    <div className="space-y-2" data-agent-model-defaults={agent}>
      <div className="flex min-w-0 items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          {translate('settings.agents.defaultModel', 'Default model')}
        </span>
        <Select
          value={modelId ?? DEFAULT}
          disabled={saving}
          onOpenChange={(open) => {
            if (open) {
              setRequested(true)
            }
          }}
          onValueChange={(model) => save({ model: model === DEFAULT ? null : model })}
        >
          <SelectTrigger
            aria-label={translate('settings.agents.defaultModel', 'Default model')}
            className="max-w-64"
            size="sm"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={DEFAULT}>{defaultLabel}</SelectItem>
            {listed.map((model) => (
              <SelectItem key={model.id} value={model.id}>
                {model.label}
              </SelectItem>
            ))}
            {modelId && !listed.some((model) => model.id === modelId) ? (
              <SelectItem value={modelId}>{modelId}</SelectItem>
            ) : null}
            {requested && models === null ? (
              <SelectItem disabled value="__loading__">
                {translate('settings.agents.loadingModels', 'Loading models…')}
              </SelectItem>
            ) : null}
          </SelectContent>
        </Select>
      </div>
      {efforts.length > 0 || value?.options?.effort ? (
        <div className="flex min-w-0 items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {translate('settings.agents.defaultEffort', 'Default effort')}
          </span>
          <Select
            value={value?.options?.effort ?? DEFAULT}
            disabled={saving}
            onValueChange={(next) => save({ options: { effort: next === DEFAULT ? null : next } })}
          >
            <SelectTrigger
              aria-label={translate('settings.agents.defaultEffort', 'Default effort')}
              className="max-w-64"
              size="sm"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT}>{defaultLabel}</SelectItem>
              {efforts.map((choice) => (
                <SelectItem key={choice.value} value={choice.value}>
                  {choice.label}
                </SelectItem>
              ))}
              {value?.options?.effort &&
              !efforts.some((choice) => choice.value === value.options?.effort) ? (
                <SelectItem value={value.options.effort}>{value.options.effort}</SelectItem>
              ) : null}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {translate(
          'settings.agents.modelDefaultsScope',
          'Applies to new chats, terminals and workers on this host. Choices made for a launch take priority.'
        )}
      </p>
    </div>
  )
}
