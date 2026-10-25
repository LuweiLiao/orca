import { useEffect, useRef, useState } from 'react'
import { ListTree } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { AgentIcon, getAgentCatalog } from '@/lib/agent-catalog'
import { getConnectionIdFromState } from '@/lib/connection-context'
import { filterEnabledTuiAgents } from '../../../../shared/tui-agent-selection'
import { useDetectedAgents } from '@/hooks/useDetectedAgents'
import { useAppStore } from '@/store'
import { runtimeTargetForOwnerEnvironment } from '@/runtime/runtime-client-target'
import { structuredAgentSessionHostKey } from '@/runtime/structured-agent-session-host-capability'
import type { TuiAgent } from '../../../../shared/tui-agent'
import { translate } from '@/i18n/i18n'
import type { NativeChatStructuredComposerTransport } from './native-chat-composer-types'
import { resolveNativeChatModelDiscoveryContext } from './native-chat-session-option-discovery'
import type { OrchestrationAgentSelection } from './native-chat-orchestration-instruction'
import {
  discoverOrchestrationModels,
  type OrchestrationModel,
  type PickerHost
} from './native-chat-orchestration-model-discovery'

const NO_SELECTIONS: OrchestrationAgentSelection[] = []

export function pickerHost(
  terminalTabId: string,
  transport?: NativeChatStructuredComposerTransport
): PickerHost | null {
  const context = resolveNativeChatModelDiscoveryContext(terminalTabId)
  if (transport) {
    const target = runtimeTargetForOwnerEnvironment(transport.runtimeEnvironmentId)
    const discovery =
      context?.runtime.worktreeId === (transport.worktreeId ?? null) &&
      structuredAgentSessionHostKey(context.runtime.target) ===
        structuredAgentSessionHostKey(target)
        ? context
        : undefined
    if (target.kind === 'environment') {
      return {
        target,
        discovery,
        preferHostCatalog: true,
        worktreeId: transport.worktreeId,
        detection: {
          kind: 'runtime',
          environmentId: target.environmentId,
          worktreeId: transport.worktreeId
        }
      }
    }
    const connectionId = transport.worktreeId
      ? getConnectionIdFromState(useAppStore.getState(), transport.worktreeId)
      : null
    if (connectionId === undefined) {
      return null
    }
    return {
      target,
      discovery,
      preferHostCatalog: !connectionId,
      worktreeId: transport.worktreeId,
      detection: connectionId
        ? { kind: 'ssh', connectionId }
        : { kind: 'local', worktreeId: transport.worktreeId }
    }
  }
  if (!context) {
    return null
  }
  const { target, worktreeId, connectionId } = context.runtime
  return {
    target,
    discovery: context,
    preferHostCatalog: false,
    detection:
      target.kind === 'environment'
        ? { kind: 'runtime', environmentId: target.environmentId, worktreeId }
        : connectionId
          ? { kind: 'ssh', connectionId }
          : { kind: 'local', worktreeId }
  }
}

export function OrchestrationPickerContent({
  host,
  onInsert,
  initialSelections = NO_SELECTIONS,
  single = false
}: {
  host: PickerHost | null
  onInsert: (selections: OrchestrationAgentSelection[]) => void
  initialSelections?: OrchestrationAgentSelection[]
  single?: boolean
}): React.JSX.Element {
  const inventory = useDetectedAgents(host ? host.detection : undefined)
  const disabledAgents = useAppStore((state) => state.settings?.disabledTuiAgents)
  const [selected, setSelected] = useState<OrchestrationAgentSelection[]>(initialSelections)
  const [models, setModels] = useState<Record<string, OrchestrationModel[] | null>>({})
  const available = new Set([
    ...filterEnabledTuiAgents(inventory.detectedIds ?? [], disabledAgents),
    ...initialSelections.map((entry) => entry.agent)
  ])
  const agents = getAgentCatalog().filter((entry) => available.has(entry.id))

  useEffect(() => {
    for (const { agent } of selected) {
      if (Object.hasOwn(models, agent) || !host) {
        continue
      }
      setModels((current) => ({ ...current, [agent]: null }))
      const listing = discoverOrchestrationModels(host, agent)
      void listing
        .then((catalog) => setModels((current) => ({ ...current, [agent]: catalog })))
        .catch(() => setModels((current) => ({ ...current, [agent]: [] })))
    }
  }, [host, models, selected])

  const toggle = (agent: TuiAgent, label: string): void => {
    if (selected.some((entry) => entry.agent === agent)) {
      setSelected((current) => current.filter((entry) => entry.agent !== agent))
      return
    }
    setSelected((current) => [
      ...(single ? [] : current),
      {
        agent,
        label,
        task: single ? (current[0]?.task ?? '') : '',
        count: single ? (current[0]?.count ?? 1) : 1
      }
    ])
  }

  return (
    <div className="flex w-80 max-w-full flex-col gap-2 text-sm">
      <div className="px-1 font-medium">
        {translate('components.native-chat.composer.orchestrationAgents', 'Orchestration agents')}
      </div>
      <div className="max-h-64 overflow-y-auto scrollbar-sleek">
        {agents.length === 0 ? (
          <div className="px-1 py-2 text-xs text-muted-foreground">
            {!host
              ? translate(
                  'components.native-chat.composer.agentHostUnavailable',
                  'Agent host is unavailable.'
                )
              : inventory.isLoading || inventory.detectedIds === null
                ? translate(
                    'components.native-chat.composer.loadingAgents',
                    'Loading available agents…'
                  )
                : translate(
                    'components.native-chat.composer.noAvailableAgents',
                    'No available agents on this host.'
                  )}
          </div>
        ) : (
          agents.map(({ id, label }) => {
            const choice = selected.find((entry) => entry.agent === id)
            const listed = models[id]
            const efforts = listed?.find((model) => model.id === choice?.model?.id)?.efforts
            return (
              <div key={id} className="space-y-1 rounded-md px-1 py-1 hover:bg-accent">
                <label className="flex min-h-7 cursor-pointer items-center gap-2">
                  <Checkbox checked={Boolean(choice)} onCheckedChange={() => toggle(id, label)} />
                  <AgentIcon agent={id} size={16} />
                  <span className="min-w-0 truncate">{label}</span>
                </label>
                {choice ? (
                  <div className="ml-6 flex flex-col gap-1.5">
                    <Input
                      density="compact"
                      value={choice.task}
                      placeholder={translate(
                        'components.native-chat.composer.orchestrationTask',
                        'Task (optional)'
                      )}
                      aria-label={`${label} ${translate('components.native-chat.composer.orchestrationTask', 'Task (optional)')}`}
                      onChange={(event) =>
                        setSelected((current) =>
                          current.map((entry) =>
                            entry.agent === id ? { ...entry, task: event.target.value } : entry
                          )
                        )
                      }
                    />
                    <div className="flex items-center gap-1.5">
                      <Input
                        density="compact"
                        type="number"
                        min={1}
                        max={99}
                        step={1}
                        value={choice.count}
                        className="w-16 shrink-0"
                        aria-label={`${label} ${translate('components.native-chat.composer.orchestrationCount', 'Agent count')}`}
                        onChange={(event) => {
                          const count = Number(event.target.value)
                          if (!Number.isInteger(count) || count < 1 || count > 99) {
                            return
                          }
                          setSelected((current) =>
                            current.map((entry) =>
                              entry.agent === id ? { ...entry, count } : entry
                            )
                          )
                        }}
                      />
                      <Select
                        value={choice.model?.id ?? '__default__'}
                        onValueChange={(value) => {
                          const model = listed?.find((model) => model.id === value)
                          setSelected((current) =>
                            current.map((entry) =>
                              entry.agent === id
                                ? {
                                    ...entry,
                                    model: model ? { id: model.id, label: model.label } : undefined,
                                    effort: model?.efforts?.some(
                                      (effort) => effort.value === entry.effort
                                    )
                                      ? entry.effort
                                      : undefined
                                  }
                                : entry
                            )
                          )
                        }}
                      >
                        <SelectTrigger
                          size="sm"
                          className="min-w-0 flex-1"
                          aria-label={`${label} ${translate('components.native-chat.composer.model', 'Model')}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__default__">
                            {translate(
                              'components.native-chat.composer.defaultModel',
                              'Default model'
                            )}
                          </SelectItem>
                          {listed === null ? (
                            <SelectItem value="__loading__" disabled>
                              {translate(
                                'components.native-chat.composer.loadingModels',
                                'Loading agent models…'
                              )}
                            </SelectItem>
                          ) : listed?.length === 0 ? (
                            <SelectItem value="__unavailable__" disabled>
                              {translate(
                                'components.native-chat.composer.modelsUnavailable',
                                'Model list unavailable'
                              )}
                            </SelectItem>
                          ) : null}
                          {choice.model &&
                          !listed?.some((model) => model.id === choice.model?.id) ? (
                            <SelectItem value={choice.model.id}>{choice.model.label}</SelectItem>
                          ) : null}
                          {listed?.map((model) => (
                            <SelectItem key={model.id} value={model.id}>
                              {model.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {choice.model ? (
                      <Select
                        value={choice.effort ?? '__default__'}
                        disabled={!efforts?.length && !choice.effort}
                        onValueChange={(value) =>
                          setSelected((current) =>
                            current.map((entry) =>
                              entry.agent === id
                                ? { ...entry, effort: value === '__default__' ? undefined : value }
                                : entry
                            )
                          )
                        }
                      >
                        <SelectTrigger
                          size="sm"
                          className="w-full min-w-0"
                          aria-label={`${label} ${translate('components.native-chat.composer.effort', 'Effort')}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__default__">
                            {translate(
                              'components.native-chat.composer.defaultEffort',
                              'Effort: default'
                            )}
                          </SelectItem>
                          {choice.effort &&
                          !efforts?.some((effort) => effort.value === choice.effort) ? (
                            <SelectItem value={choice.effort}>{choice.effort}</SelectItem>
                          ) : null}
                          {efforts?.map((effort) => (
                            <SelectItem key={effort.value} value={effort.value}>
                              {effort.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )
          })
        )}
      </div>
      <Button
        type="button"
        size="sm"
        disabled={selected.length === 0}
        onClick={() => onInsert(selected)}
      >
        {single
          ? translate('components.native-chat.composer.updateOrchestration', 'Update orchestration')
          : translate(
              'components.native-chat.composer.addOrchestrationToMessage',
              'Add to message'
            )}
      </Button>
    </div>
  )
}

export function NativeChatOrchestrationPicker({
  terminalTabId,
  structuredTransport,
  onInsert
}: {
  terminalTabId: string
  structuredTransport?: NativeChatStructuredComposerTransport
  onInsert: (selections: OrchestrationAgentSelection[]) => boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const insertedRef = useRef(false)
  const label = translate(
    'components.native-chat.composer.orchestrationAgents',
    'Orchestration agents'
  )
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={label}
              className="pointer-coarse:size-11"
            >
              <ListTree className="size-4" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={4}>
          {label}
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        side="top"
        align="start"
        collisionPadding={8}
        onCloseAutoFocus={(event) => {
          if (insertedRef.current) {
            event.preventDefault()
            insertedRef.current = false
          }
        }}
        className="w-84 max-w-(--radix-popover-content-available-width)"
      >
        {open ? (
          <OrchestrationPickerContent
            host={pickerHost(terminalTabId, structuredTransport)}
            onInsert={(selections) => {
              if (onInsert(selections)) {
                insertedRef.current = true
                setOpen(false)
              }
            }}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
