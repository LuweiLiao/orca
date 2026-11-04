import {
  CHAT_CAPABILITIES_OPTION,
  chatSelectionChanged,
  isEmptyChatSelection,
  readChatSelection,
  type AgentSessionChatCapabilities,
  type AgentSessionChatMcpServer
} from '../../shared/agent-session-chat-capabilities'
import { isRecord } from '../../shared/agent-status-child-work-value-guards'
import type { CodexAppServerConnection } from './codex-app-server-connection'
import { requestCodexSkillReport } from './codex-skill-list'

// A local read; bounded so a wedged app-server cannot hold the thread open.
const TOOL_CONFIG_READ_TIMEOUT_MS = 5_000

const MCP_STARTUP_STATUS_METHOD = 'mcpServer/startupStatus/updated'

type CodexConfiguredMcpServer = { name: string; enabled: boolean }

type CodexToolConfig = {
  mcpServers: CodexConfiguredMcpServer[]
  skillEntries: unknown[]
}

/** What this child launched with and what it has reported about its MCP servers. */
export type CodexChatCapabilityState = {
  launched: string | undefined
  /** Undefined until config/read answers; servers it lists are switchable. */
  configuredMcp?: readonly CodexConfiguredMcpServer[]
  mcpStartup: Map<string, string>
}

type CodexRequester = Pick<CodexAppServerConnection, 'request'>

async function readCodexToolConfig(
  connection: CodexRequester,
  cwd: string,
  timeoutMs: number | undefined
): Promise<CodexToolConfig | null> {
  try {
    const response = await connection.request(
      'config/read',
      { cwd },
      {
        timeoutMs: Math.min(timeoutMs ?? TOOL_CONFIG_READ_TIMEOUT_MS, TOOL_CONFIG_READ_TIMEOUT_MS)
      }
    )
    const config = isRecord(response) ? response.config : undefined
    if (!isRecord(config)) {
      return null
    }
    const servers = isRecord(config.mcp_servers) ? config.mcp_servers : {}
    const skills = isRecord(config.skills) ? config.skills.config : undefined
    return {
      mcpServers: Object.entries(servers).map(([name, server]) => ({
        name,
        enabled: !(isRecord(server) && server.enabled === false)
      })),
      skillEntries: Array.isArray(skills) ? skills : []
    }
  } catch {
    return null
  }
}

/** Override keys split on dots, so such a name cannot be addressed alone. */
function addressableServerName(name: string): boolean {
  return !name.includes('.')
}

function skillEntryPath(entry: unknown): string | undefined {
  return isRecord(entry) && typeof entry.path === 'string' ? entry.path : undefined
}

// Refuse rather than start a conversation whose disabled tools are still loaded.
function unappliedSelection(): Error {
  return new Error(
    'Codex did not report its configuration, so the Skill/MCP selection for this conversation cannot be applied. Enable all capabilities for this conversation or update Codex.'
  )
}

/**
 * Thread-scoped overrides for one conversation's selection; config.toml is never written.
 * Only servers config.toml defines are disabled: naming a plugin's or a removed server fails
 * the thread open. skills.config replaces Codex's list, so the user's own entries are kept.
 */
export async function codexChatCapabilityLaunch(
  connection: CodexRequester,
  cwd: string,
  encoded: string | undefined,
  timeoutMs: number | undefined
): Promise<{
  threadConfig: Record<string, unknown>
  state: CodexChatCapabilityState
}> {
  const selection = readChatSelection(encoded)
  const state: CodexChatCapabilityState = { launched: encoded, mcpStartup: new Map() }
  if (isEmptyChatSelection(selection)) {
    return { threadConfig: {}, state }
  }
  const toolConfig = await readCodexToolConfig(connection, cwd, timeoutMs)
  if (!toolConfig) {
    throw unappliedSelection()
  }
  state.configuredMcp = toolConfig.mcpServers
  const threadConfig: Record<string, unknown> = {}
  for (const name of selection.disabledMcpServers) {
    if (
      addressableServerName(name) &&
      toolConfig.mcpServers.some((server) => server.name === name && server.enabled)
    ) {
      threadConfig[`mcp_servers.${name}.enabled`] = false
    }
  }
  if (selection.disabledSkills.length > 0) {
    const disabled = new Set(selection.disabledSkills)
    const rows = await requestCodexSkillReport(connection, cwd, {
      timeoutMs
    }).catch(() => {
      throw unappliedSelection()
    })
    const paths = rows
      .filter((row) => row.kind === 'skill' && row.path && disabled.has(row.name))
      .flatMap((row) => (row.path ? [row.path] : []))
    if (paths.length > 0) {
      const replaced = new Set(paths)
      threadConfig['skills.config'] = [
        ...toolConfig.skillEntries.filter((entry) => !replaced.has(skillEntryPath(entry) ?? '')),
        ...paths.map((path) => ({ path, enabled: false }))
      ]
    }
  }
  return { threadConfig, state }
}

/** A launch with an empty selection reads the configured servers after the thread opens. */
export async function readCodexConfiguredMcp(
  connection: CodexRequester,
  cwd: string,
  state: CodexChatCapabilityState,
  timeoutMs: number | undefined
): Promise<boolean> {
  if (state.configuredMcp) {
    return false
  }
  const toolConfig = await readCodexToolConfig(connection, cwd, timeoutMs)
  state.configuredMcp = toolConfig?.mcpServers ?? []
  return true
}

/** Startup reports name only the servers this thread started. */
export function observeCodexMcpStartup(
  state: CodexChatCapabilityState | undefined,
  method: string,
  params: unknown,
  threadId: string
): boolean {
  if (!state || method !== MCP_STARTUP_STATUS_METHOD || !isRecord(params)) {
    return false
  }
  const { name, status } = params
  const reportedThread = typeof params.threadId === 'string' ? params.threadId : null
  if (typeof name !== 'string' || typeof status !== 'string') {
    return false
  }
  if (reportedThread !== null && reportedThread !== threadId) {
    return false
  }
  if (state.mcpStartup.get(name) === status) {
    return false
  }
  state.mcpStartup.set(name, status)
  return true
}

const CODEX_MCP_STATUS: Readonly<Record<string, string>> = {
  ready: 'connected',
  starting: 'pending'
}

export function codexChatCapabilityReport(
  state: CodexChatCapabilityState | undefined,
  skills: AgentSessionChatCapabilities['skills'] | undefined
): AgentSessionChatCapabilities | undefined {
  if (!state) {
    return undefined
  }
  const selection = readChatSelection(state.launched)
  const configured = state.configuredMcp ?? []
  const status = (name: string) => {
    const reported = state.mcpStartup.get(name)
    return reported ? (CODEX_MCP_STATUS[reported] ?? reported) : ''
  }
  const mcpServers: AgentSessionChatMcpServer[] = [
    ...configured.map(({ name, enabled }): AgentSessionChatMcpServer => {
      if (!enabled) {
        return { name, status: 'disabled', locked: 'config-disabled' }
      }
      if (!addressableServerName(name)) {
        return { name, status: status(name), locked: 'unsupported' }
      }
      return {
        name,
        status: selection.disabledMcpServers.includes(name) ? 'disabled' : status(name)
      }
    }),
    ...[...state.mcpStartup.keys()]
      .filter((name) => !configured.some((server) => server.name === name))
      .map((name): AgentSessionChatMcpServer => ({ name, status: status(name), locked: 'plugin' }))
  ]
  return {
    selection,
    skills: (skills ?? []).filter((command) => command.kind === 'skill'),
    mcpServers
  }
}

export function codexChatSelectionRequiresRestart(
  state: CodexChatCapabilityState | undefined,
  options: Readonly<Record<string, string>> | undefined
): boolean {
  return state ? chatSelectionChanged(state.launched, options?.[CHAT_CAPABILITIES_OPTION]) : false
}
