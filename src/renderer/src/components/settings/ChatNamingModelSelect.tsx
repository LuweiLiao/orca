import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  getCommitMessageAgentCapability,
  isCustomAgentId,
  resolveCommitMessageAgentChoice
} from '../../../../shared/commit-message-agent-spec'
import { resolveSourceControlAiForOperation } from '../../../../shared/source-control-ai'
import {
  chatNamingModelArgument,
  replaceChatNamingModelArgument
} from '../../../../shared/chat-naming-model-arguments'
import { discoverNativeChatCatalogModels } from '../native-chat/native-chat-session-option-discovery'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

type Model = { id: string; label: string }

export function ChatNamingModelSelect({
  settings,
  agentArgs,
  onChange
}: {
  settings: GlobalSettings
  agentArgs: string
  onChange: (args: string) => void
}): React.JSX.Element | null {
  const resolved = resolveSourceControlAiForOperation({ settings, operation: 'conversationName' })
  const agent = resolved.ok
    ? resolved.value.params.agentId
    : resolveCommitMessageAgentChoice(
        settings.sourceControlAi?.actions?.conversationName?.agentId,
        settings.defaultTuiAgent,
        settings.disabledTuiAgents
      )
  const capability =
    agent && !isCustomAgentId(agent) ? getCommitMessageAgentCapability(agent) : undefined
  const [discovery, setDiscovery] = useState<{ agent: string; models: Model[] } | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const command = agent && !isCustomAgentId(agent) ? settings.agentCmdOverrides?.[agent] : undefined
  useEffect(() => {
    if (!agent || isCustomAgentId(agent) || capability?.modelSource !== 'dynamic') {
      return
    }
    let stale = false
    setLoading(true)
    setError(false)
    void discoverNativeChatCatalogModels(
      agent,
      {
        target: { kind: 'local' },
        prefs: settings,
        worktreeId: null,
        worktreePath: ''
      },
      'local'
    )
      .then((models) => {
        if (stale) {
          return
        }
        if (models?.length) {
          setDiscovery({ agent, models })
        } else {
          setError(true)
        }
      })
      .catch(() => {
        if (!stale) {
          setError(true)
        }
      })
      .finally(() => {
        if (!stale) {
          setLoading(false)
        }
      })
    return () => {
      stale = true
    }
    // Discovery depends on the agent command, not unrelated settings edits.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [agent, capability?.modelSource, command, refresh])
  if (!capability || !agent || isCustomAgentId(agent)) {
    return null
  }
  const selected =
    chatNamingModelArgument(agentArgs) ??
    (resolved.ok ? resolved.value.params.model : capability.defaultModelId)
  const models = [...(discovery?.agent === agent ? discovery.models : capability.models)]
  const chatModel = settings.nativeChatSessionOptions?.[agent]?.model
  for (const id of [selected, chatModel]) {
    if (id && !models.some((model) => model.id === id)) {
      models.push({ id, label: id })
    }
  }
  const label = translate('settings.chat.names.model', 'Model')
  const refreshLabel = translate('settings.chat.names.refreshModels', 'Refresh models')
  return (
    <div className="min-w-0 space-y-2">
      <Label htmlFor="chat-naming-model">{label}</Label>
      <div className="flex min-w-0 items-center gap-1">
        <Select
          value={selected}
          onValueChange={(id) => onChange(replaceChatNamingModelArgument(agentArgs, id))}
        >
          <SelectTrigger
            id="chat-naming-model"
            aria-label={label}
            size="sm"
            className="min-w-0 flex-1"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {models.map((model) => (
              <SelectItem key={model.id} value={model.id}>
                {model.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {capability.modelSource === 'dynamic' ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={refreshLabel}
                disabled={loading}
                onClick={() => setRefresh((n) => n + 1)}
              >
                <RefreshCw className={loading ? 'size-3.5 animate-spin' : 'size-3.5'} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{refreshLabel}</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      {error ? (
        <p role="status" className="text-xs text-muted-foreground">
          {translate(
            'settings.chat.names.modelsUnavailable',
            'Could not refresh models. Showing saved and built-in models.'
          )}
        </p>
      ) : null}
    </div>
  )
}
