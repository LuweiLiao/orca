import { useMemo } from 'react'
import { CornerDownLeft, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type {
  AgentSessionChatCapabilities,
  AgentSessionChatEntryLock,
  AgentSessionChatSelection
} from '../../../../shared/agent-session-chat-capabilities'
import type { AgentSessionSlashCommand } from '../../../../shared/agent-session-wire'
import type { NativeChatMessage } from '../../../../shared/native-chat-types'
import {
  nativeChatCapabilityUsage,
  type NativeChatCapabilityUse
} from './native-chat-capability-usage'
import { NativeChatSidebarSection } from './NativeChatSidebarSection'

export type NativeChatCapabilityControls = {
  capabilities?: AgentSessionChatCapabilities
  commands?: readonly AgentSessionSlashCommand[]
  onChange: (selection: AgentSessionChatSelection) => Promise<boolean>
  onUseSkill: (name: string, path?: string) => void
  canUseSkill: boolean
}

type SelectionKey = keyof AgentSessionChatSelection

type CapabilityRow = {
  name: string
  detail?: string
  status?: string
  locked?: AgentSessionChatEntryLock
  path?: string
  used?: NativeChatCapabilityUse
}

export type NativeChatCapabilityGroups = {
  skills: CapabilityRow[]
  mcpServers: CapabilityRow[]
}

const EMPTY_SELECTION: AgentSessionChatSelection = { disabledSkills: [], disabledMcpServers: [] }

/** Every entry the provider reported, one the selection names, or one the transcript used. */
export function useNativeChatCapabilityGroups(
  messages: readonly NativeChatMessage[],
  controls: NativeChatCapabilityControls | undefined
): NativeChatCapabilityGroups {
  const usage = useMemo(() => nativeChatCapabilityUsage(messages), [messages])
  const capabilities = controls?.capabilities
  const selection = capabilities?.selection ?? EMPTY_SELECTION
  const skills = new Map<string, CapabilityRow>()
  for (const command of [...(controls?.commands ?? []), ...(capabilities?.skills ?? [])]) {
    if (command.kind === 'skill') {
      skills.set(command.name, {
        name: command.name,
        ...(command.description ? { detail: command.description } : {}),
        ...(command.path ? { path: command.path } : {})
      })
    }
  }
  const servers = new Map<string, CapabilityRow>(
    (capabilities?.mcpServers ?? []).map((server) => [
      server.name,
      {
        name: server.name,
        ...(server.status ? { status: server.status } : {}),
        ...(server.locked ? { locked: server.locked } : {})
      }
    ])
  )
  const complete = (rows: Map<string, CapabilityRow>, names: Iterable<string>) => {
    for (const name of names) {
      if (!rows.has(name)) {
        rows.set(name, { name })
      }
    }
  }
  complete(skills, [...selection.disabledSkills, ...usage.skills.keys()])
  complete(servers, [...selection.disabledMcpServers, ...usage.mcpServers.keys()])
  const withUse = (rows: Map<string, CapabilityRow>, uses: Map<string, NativeChatCapabilityUse>) =>
    [...rows.values()].map((row) => {
      const used = uses.get(row.name)
      return used ? { ...row, used } : row
    })
  return {
    skills: withUse(skills, usage.skills),
    mcpServers: withUse(servers, usage.mcpServers)
  }
}

/** The names "Disable all" turns off: every entry that can be switched. */
export function switchableNames(rows: readonly CapabilityRow[]): string[] {
  return rows.filter((row) => !row.locked).map((row) => row.name)
}

function mcpStatusLabel(status: string): string {
  switch (status) {
    case 'connected':
      return translate('components.native-chat.capabilitiesStatusConnected', 'Connected')
    case 'pending':
      return translate('components.native-chat.capabilitiesStatusPending', 'Starting')
    case 'failed':
      return translate('components.native-chat.capabilitiesStatusFailed', 'Failed')
    case 'needs-auth':
      return translate('components.native-chat.capabilitiesStatusNeedsAuth', 'Sign-in required')
    case 'disabled':
      return translate('components.native-chat.capabilitiesStatusDisabled', 'Off')
    default:
      return status
  }
}

function lockLabel(lock: AgentSessionChatEntryLock): string {
  switch (lock) {
    case 'plugin':
      return translate(
        'components.native-chat.capabilitiesLockedPlugin',
        'Provided by a plugin; switch it in the plugin settings'
      )
    case 'config-disabled':
      return translate(
        'components.native-chat.capabilitiesLockedConfig',
        'Turned off in the agent configuration'
      )
    default:
      return translate(
        'components.native-chat.capabilitiesLockedUnsupported',
        'This entry cannot be switched for one conversation'
      )
  }
}

function matches(row: CapabilityRow, query: string): boolean {
  const needle = query.trim().toLowerCase()
  return (
    needle.length === 0 ||
    row.name.toLowerCase().includes(needle) ||
    (row.detail?.toLowerCase().includes(needle) ?? false)
  )
}

export function NativeChatCapabilitySection({
  title,
  selectionKey,
  rows,
  query,
  controls,
  pending,
  onChange,
  onReveal
}: {
  title: string
  selectionKey: SelectionKey
  rows: readonly CapabilityRow[]
  query: string
  controls?: NativeChatCapabilityControls
  pending: boolean
  onChange: (selection: AgentSessionChatSelection) => void
  onReveal: (messageId: string) => void
}) {
  const capabilities = controls?.capabilities
  const selection = capabilities?.selection ?? EMPTY_SELECTION
  const disabled = new Set(selection[selectionKey])
  const enabledCount = rows.filter((row) => !row.locked && !disabled.has(row.name)).length
  const switchable = rows.filter((row) => !row.locked).length
  const visible = rows.filter((row) => matches(row, query))
  return (
    <NativeChatSidebarSection
      title={title}
      count={capabilities && switchable > 0 ? `${enabledCount}/${rows.length}` : `${rows.length}`}
    >
      {visible.length === 0 ? (
        <p className="px-3 py-1.5 text-xs text-muted-foreground">
          {rows.length === 0
            ? translate('components.native-chat.capabilitiesNotReported', 'No entries reported yet')
            : translate('components.native-chat.capabilitiesNoMatch', 'No matches')}
        </p>
      ) : (
        <ul className="px-1.5 pb-1">
          {visible.map((row) => {
            const enabled = !row.locked && !disabled.has(row.name)
            const isSkill = selectionKey === 'disabledSkills'
            const secondary = row.status ? mcpStatusLabel(row.status) : row.detail
            return (
              <li
                key={row.name}
                className="group/capability flex min-h-8 items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-accent"
              >
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      'truncate text-xs',
                      capabilities && !enabled ? 'text-muted-foreground' : 'text-foreground'
                    )}
                    title={row.detail ? `${row.name}\n${row.detail}` : row.name}
                  >
                    {row.name}
                  </div>
                  {secondary ? (
                    <div
                      className={cn(
                        'truncate text-2xs text-muted-foreground',
                        row.status === 'failed' && 'text-chat-warning'
                      )}
                    >
                      {secondary}
                    </div>
                  ) : null}
                </div>
                {row.used ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="xs"
                        variant="ghost"
                        className="h-5 shrink-0 px-1.5 text-2xs text-muted-foreground tabular-nums"
                        aria-label={`${row.name}: ${translate('components.native-chat.capabilitiesUsed', 'Used')} ${row.used.count}`}
                        onClick={() => row.used && onReveal(row.used.messageId)}
                      >
                        {row.used.count}×
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top" sideOffset={4}>
                      {translate(
                        'components.native-chat.capabilitiesUsedHint',
                        'Used {{count}} times in loaded messages. Show the latest',
                        { count: row.used.count }
                      )}
                    </TooltipContent>
                  </Tooltip>
                ) : null}
                {isSkill && controls?.canUseSkill ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        className="shrink-0 text-muted-foreground opacity-0 group-hover/capability:opacity-100 focus-visible:opacity-100 disabled:opacity-0"
                        aria-label={translate(
                          'components.native-chat.capabilitiesUseThisTurn',
                          'Use this turn'
                        )}
                        disabled={(capabilities !== undefined && !enabled) || pending}
                        onClick={() => controls.onUseSkill(row.name, row.path)}
                      >
                        <CornerDownLeft className="size-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top" sideOffset={4}>
                      {translate('components.native-chat.capabilitiesUseThisTurn', 'Use this turn')}
                    </TooltipContent>
                  </Tooltip>
                ) : null}
                {capabilities ? (
                  row.locked ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          tabIndex={0}
                          aria-label={`${row.name}: ${lockLabel(row.locked)}`}
                          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <Lock className="size-3" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top" sideOffset={4}>
                        {lockLabel(row.locked)}
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <Switch
                      size="compact"
                      className="mx-0.5"
                      aria-label={`${title}: ${row.name}`}
                      checked={enabled}
                      disabled={pending}
                      onCheckedChange={(checked) =>
                        onChange({
                          ...selection,
                          [selectionKey]: checked
                            ? selection[selectionKey].filter((item) => item !== row.name)
                            : [...selection[selectionKey], row.name]
                        })
                      }
                    />
                  )
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </NativeChatSidebarSection>
  )
}
