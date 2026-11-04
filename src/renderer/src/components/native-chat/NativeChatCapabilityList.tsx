import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { translate } from '@/i18n/i18n'
import type {
  AgentSessionChatCapabilities,
  AgentSessionChatSelection
} from '../../../../shared/agent-session-chat-capabilities'
import type { AgentSessionSlashCommand } from '../../../../shared/agent-session-wire'
import type { NativeChatMessage } from '../../../../shared/native-chat-types'
import { nativeChatCapabilityUsage } from './native-chat-capability-usage'

export type NativeChatCapabilityControls = {
  capabilities?: AgentSessionChatCapabilities
  commands?: readonly AgentSessionSlashCommand[]
  onChange: (selection: AgentSessionChatSelection) => Promise<boolean>
  onUseSkill: (name: string, path?: string) => void
  canUseSkill: boolean
}

export function NativeChatCapabilityList({
  messages,
  controls,
  onReveal
}: {
  messages: readonly NativeChatMessage[]
  controls?: NativeChatCapabilityControls
  onReveal: (messageId: string) => void
}) {
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState(false)
  const usage = useMemo(() => nativeChatCapabilityUsage(messages), [messages])
  const capabilities = controls?.capabilities
  const selection = capabilities?.selection ?? { disabledSkills: [], disabledMcpServers: [] }
  const skills = new Map(
    [...(controls?.commands ?? []), ...(capabilities?.skills ?? [])]
      .filter((command) => command.kind === 'skill')
      .map((skill) => [skill.name, skill])
  )
  for (const name of [...selection.disabledSkills, ...usage.skills.keys()]) {
    if (!skills.has(name)) {
      skills.set(name, { name, kind: 'skill' })
    }
  }
  const servers = new Map(
    (capabilities?.mcpServers ?? []).map((server) => [server.name, server.status])
  )
  for (const name of [...selection.disabledMcpServers, ...usage.mcpServers.keys()]) {
    if (!servers.has(name)) {
      servers.set(name, '')
    }
  }
  const change = async (next: AgentSessionChatSelection) => {
    if (!controls || pending) {
      return
    }
    setPending(true)
    try {
      await controls.onChange(next)
    } finally {
      setPending(false)
    }
  }
  const groups = [
    {
      title: translate('components.native-chat.capabilitiesSkills', 'Skill'),
      key: 'disabledSkills' as const,
      rows: [...skills.keys()],
      uses: usage.skills
    },
    {
      title: translate('components.native-chat.capabilitiesMcp', 'MCP'),
      key: 'disabledMcpServers' as const,
      rows: [...servers.keys()],
      uses: usage.mcpServers
    }
  ]
  return (
    <section className="flex min-h-0 flex-col gap-2 border-b p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium">
          {translate('components.native-chat.capabilitiesTitle', 'Skill / MCP')}
        </span>
        {capabilities ? (
          <div className="flex gap-1">
            <Button
              size="xs"
              variant="ghost"
              disabled={pending}
              onClick={() => void change({ disabledSkills: [], disabledMcpServers: [] })}
            >
              {translate('components.native-chat.capabilitiesEnableAll', 'Enable all')}
            </Button>
            <Button
              size="xs"
              variant="ghost"
              disabled={pending}
              onClick={() =>
                void change({
                  disabledSkills: [...skills.keys()],
                  disabledMcpServers: [...servers.keys()]
                })
              }
            >
              {translate('components.native-chat.capabilitiesDisableAll', 'Disable all')}
            </Button>
          </div>
        ) : null}
      </div>
      <Input
        aria-label={translate('components.native-chat.capabilitiesSearch', 'Search skills and MCP')}
        placeholder={translate(
          'components.native-chat.capabilitiesSearch',
          'Search skills and MCP'
        )}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="scrollbar-sleek min-h-0 overflow-y-auto">
        {groups.map((group) => (
          <div key={group.key} className="space-y-1 py-2">
            <div className="text-xs font-medium text-muted-foreground">
              {group.title} · {group.rows.length}
            </div>
            {group.rows
              .filter((name) => name.toLowerCase().includes(query.toLowerCase()))
              .map((name) => {
                const enabled = !selection[group.key].includes(name)
                const used = group.uses.get(name)
                const skill = group.key === 'disabledSkills' ? skills.get(name) : undefined
                return (
                  <div key={name} className="flex items-center gap-2 py-1">
                    {capabilities ? (
                      <Switch
                        aria-label={`${group.title}: ${name}`}
                        checked={enabled}
                        disabled={pending}
                        onCheckedChange={(checked) =>
                          void change({
                            ...selection,
                            [group.key]: checked
                              ? selection[group.key].filter((item) => item !== name)
                              : [...selection[group.key], name]
                          })
                        }
                      />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs" title={skill?.description ?? name}>
                        {name}
                      </div>
                      {group.key === 'disabledMcpServers' && servers.get(name) ? (
                        <div className="text-xs text-muted-foreground">{servers.get(name)}</div>
                      ) : null}
                    </div>
                    {used ? (
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => onReveal(used.messageId)}
                        aria-label={`${name}: ${translate('components.native-chat.capabilitiesUsed', 'Used')} ${used.count}`}
                      >
                        {used.count}×
                      </Button>
                    ) : null}
                    {skill && controls?.canUseSkill ? (
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={!enabled || pending}
                        onClick={() => controls.onUseSkill(name, skill.path)}
                      >
                        {translate(
                          'components.native-chat.capabilitiesUseThisTurn',
                          'Use this turn'
                        )}
                      </Button>
                    ) : null}
                  </div>
                )
              })}
            {group.rows.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {translate(
                  'components.native-chat.capabilitiesNotReported',
                  'No entries reported yet'
                )}
              </p>
            ) : null}
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {capabilities
          ? translate(
              'components.native-chat.capabilitiesNextTurn',
              'Changes apply to the next message. Tool changes may refresh the prompt cache.'
            )
          : translate(
              'components.native-chat.capabilitiesReadOnly',
              'This host or provider reports usage only.'
            )}
      </p>
      <p className="text-xs text-muted-foreground">
        {translate(
          'components.native-chat.capabilitiesLoadedUsage',
          'Usage counts cover loaded messages.'
        )}
      </p>
    </section>
  )
}
