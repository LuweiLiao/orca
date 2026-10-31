import type {
  AgentLaunchSettings,
  AgentLaunchSettingsSource,
  AgentLaunchSettingsMutation
} from './agent-launch-settings-types'
export type {
  AgentLaunchSettings,
  AgentLaunchSettingsSource,
  AgentLaunchSettingsMutation
} from './agent-launch-settings-types'
import { resolveLocalWindowsAgentStartupShell } from './windows-terminal-shell'
import { resolveStartupShell } from './tui-agent-startup-shell'
import { agentPermissionHostPlatform } from './agent-permission-env'
import { agentLaunchChoiceUpdates } from './agent-launch-choice-updates'
import { projectAgentLaunchProfile } from './agent-launch-profile'
import { agentEnvironmentMutationUpdates, choiceUpdate } from './agent-launch-environment-updates'
import {
  agentChatPermissionModes,
  type AgentChatPermissionMode
} from './agent-chat-permission-mode'
import type { TuiAgent } from './tui-agent'
import { isTuiAgent } from './tui-agent-config'
import { buildDefaultAgentSettingsUpdate } from './default-agent-settings'
import {
  buildAgentAvailabilitySettingsUpdate,
  normalizeDisabledTuiAgents
} from './tui-agent-selection'
import {
  composeAgentLaunchProfile,
  normalizeTuiAgentArgsRecord,
  resolveTuiAgentLaunchArgs,
  resolveTuiAgentLaunchEnv
} from './tui-agent-launch-defaults'
import { hasTypedAgentPermission } from './tui-agent-permission-choice'
import { liftAgentPermissionArgs } from './tui-agent-permission-lift'
import {
  legacyArgumentsUpdates,
  legacyPermissionsUpdates,
  permissionUpdates
} from './agent-launch-permission-updates'
import {
  applyAgentPermissionMode,
  AUTO_TUI_AGENT_ARGS,
  YOLO_TUI_AGENT_ARGS,
  YOLO_TUI_AGENT_ENV,
  resolveTuiAgentPermissionMode,
  resolveAgentPermissionModeSummary,
  resolveNonAutoAgentPermissionMode
} from './tui-agent-permissions'

export function projectAgentLaunchSettings(
  settings: AgentLaunchSettingsSource,
  platform?: NodeJS.Platform
): AgentLaunchSettings {
  const hostPlatform = platform ?? agentPermissionHostPlatform()
  const shell = resolveStartupShell(
    hostPlatform,
    resolveLocalWindowsAgentStartupShell({
      platform: hostPlatform,
      isRemote: false,
      terminalWindowsShell: settings.terminalWindowsShell
    })
  )
  const composed = composeAgentLaunchProfile(settings, hostPlatform)
  const permissionMode = resolveAgentPermissionModeSummary(composed)
  return {
    defaultTuiAgent: settings.defaultTuiAgent ?? null,
    newWorkspaceSetupOnly: false,
    disabledTuiAgents: normalizeDisabledTuiAgents(settings.disabledTuiAgents),
    agentCmdOverrides: { ...settings.agentCmdOverrides },
    agentDefaultArgs: normalizeTuiAgentArgsRecord(composed.agentDefaultArgs),
    environmentNames: Object.fromEntries(
      Object.entries(composed.agentDefaultEnv).map(([agent, env]) => [
        agent,
        Object.keys(env ?? {}).sort()
      ])
    ),
    // Older clients understand Mixed and ignore the optional automatic-mode marker.
    permissionMode: permissionMode === 'auto' ? 'mixed' : permissionMode,
    ...(permissionMode === 'auto'
      ? {
          autoPermissionMode: true,
          nonAutoPermissionMode: resolveNonAutoAgentPermissionMode(composed)
        }
      : {}),
    ...(settings.agentLaunchChoices !== undefined
      ? {
          agentChoices: {
            defaults: settings.agentLaunchChoices,
            userArgs: normalizeTuiAgentArgsRecord(settings.agentDefaultArgs)
          }
        }
      : {}),
    ...(hasTypedAgentPermission(settings)
      ? {
          agentPermission: {
            default: settings.agentPermissionDefault ?? 'own',
            overrides: { ...settings.agentPermissionOverrides },
            userArgs: Object.fromEntries(
              Object.keys(composed.agentDefaultArgs)
                .filter(isTuiAgent)
                .map((agent) => [
                  agent,
                  projectAgentLaunchProfile(agent, settings, { target: 'legacy-permission', shell })
                    .args
                ])
            )
          }
        }
      : {})
  }
}

function nativeChatModesForPreset(
  settings: AgentLaunchSettingsSource,
  mode: AgentChatPermissionMode,
  autoOnly: boolean
): Partial<Record<TuiAgent, AgentChatPermissionMode>> {
  return Object.fromEntries(
    [...Object.keys(YOLO_TUI_AGENT_ARGS), ...Object.keys(YOLO_TUI_AGENT_ENV)]
      .filter((agent): agent is TuiAgent => isTuiAgent(agent))
      .filter(
        (agent) =>
          agent in AUTO_TUI_AGENT_ARGS === autoOnly &&
          agentChatPermissionModes(agent) &&
          resolveTuiAgentPermissionMode({
            agent,
            agentArgs: resolveTuiAgentLaunchArgs(agent, settings),
            agentEnv: resolveTuiAgentLaunchEnv(agent, settings)
          }) !== 'mixed'
      )
      .map((agent) => [agent, mode])
  )
}

export function agentLaunchSettingsMutationUpdates(
  settings: AgentLaunchSettingsSource,
  mutation: AgentLaunchSettingsMutation,
  platform: NodeJS.Platform
): AgentLaunchSettingsSource {
  const shell = resolveStartupShell(
    platform,
    resolveLocalWindowsAgentStartupShell({
      platform,
      isRemote: false,
      terminalWindowsShell: settings.terminalWindowsShell
    })
  )
  switch (mutation.type) {
    case 'default':
      return buildDefaultAgentSettingsUpdate(mutation.agent)
    case 'availability':
      return buildAgentAvailabilitySettingsUpdate(
        {
          defaultTuiAgent: settings.defaultTuiAgent ?? null,
          disabledTuiAgents: settings.disabledTuiAgents ?? []
        },
        mutation.agent,
        mutation.enabled
      )
    case 'permission':
      if (!hasTypedAgentPermission(settings)) {
        throw new Error('This host stores permissions in launch arguments')
      }
      return permissionUpdates(settings, mutation)
    case 'permissions': {
      const nativeMode =
        mutation.mode === 'yolo' ? 'full-access' : mutation.mode === 'auto' ? 'auto' : 'ask'
      const typed = hasTypedAgentPermission(settings)
      const terminal = (args: Parameters<typeof applyAgentPermissionMode>[0]) =>
        typed ? legacyPermissionsUpdates(settings, mutation) : applyAgentPermissionMode(args)
      if (mutation.agent) {
        const agent = mutation.agent
        if (!(agent in YOLO_TUI_AGENT_ARGS) && !(agent in YOLO_TUI_AGENT_ENV)) {
          throw new Error('This agent has no configurable terminal permission mode')
        }
        if (mutation.mode === 'auto' && !AUTO_TUI_AGENT_ARGS[agent]) {
          throw new Error('This agent does not support automatic permission review')
        }
        if (
          !typed &&
          resolveTuiAgentPermissionMode({
            agent,
            agentArgs: resolveTuiAgentLaunchArgs(agent, settings),
            agentEnv: resolveTuiAgentLaunchEnv(agent, settings)
          }) === 'mixed'
        ) {
          throw new Error('Edit custom launch arguments before choosing a permission mode')
        }
        return {
          ...terminal({ ...settings, mode: mutation.mode, agent }),
          ...(mutation.syncNativeChat && agentChatPermissionModes(agent)
            ? {
                agentNativeChatPermissionModes: {
                  ...settings.agentNativeChatPermissionModes,
                  [agent]: nativeMode
                }
              }
            : {})
        }
      }
      if (mutation.exceptAuto) {
        if (mutation.mode === 'auto') {
          throw new Error('Auto cannot apply to agents without automatic permission review')
        }
        return {
          ...terminal({ ...settings, mode: mutation.mode, exceptAuto: true }),
          ...(mutation.syncNativeChat
            ? {
                agentNativeChatPermissionModes: {
                  ...settings.agentNativeChatPermissionModes,
                  ...nativeChatModesForPreset(settings, nativeMode, false)
                }
              }
            : {})
        }
      }
      if (mutation.mode === 'auto') {
        return {
          ...terminal({ ...settings, mode: mutation.mode }),
          ...(mutation.syncNativeChat
            ? {
                agentNativeChatPermissionModes: {
                  ...settings.agentNativeChatPermissionModes,
                  ...nativeChatModesForPreset(settings, nativeMode, true)
                }
              }
            : {})
        }
      }
      return {
        ...terminal({ ...settings, mode: mutation.mode }),
        ...(mutation.syncNativeChat
          ? { nativeChatPermissionMode: nativeMode, agentNativeChatPermissionModes: {} }
          : {})
      }
    }
    case 'command': {
      const commands = { ...settings.agentCmdOverrides }
      if (mutation.value.trim()) {
        commands[mutation.agent] = mutation.value.trim()
      } else {
        delete commands[mutation.agent]
      }
      return { agentCmdOverrides: commands }
    }
    case 'launch-choices':
      return agentLaunchChoiceUpdates(settings, mutation.agent, mutation)
    case 'arguments':
      if (settings.agentLaunchChoices !== undefined) {
        return agentLaunchChoiceUpdates(
          settings,
          mutation.agent,
          { userArgs: mutation.value },
          { target: 'terminal', shell }
        )
      }
      if (hasTypedAgentPermission(settings)) {
        return legacyArgumentsUpdates(settings, mutation.agent, mutation.value, platform)
      }
      return {
        agentDefaultArgs: normalizeTuiAgentArgsRecord({
          ...settings.agentDefaultArgs,
          [mutation.agent]: mutation.value
        })
      }
    case 'user-arguments': {
      if (settings.agentLaunchChoices !== undefined) {
        return agentLaunchChoiceUpdates(
          settings,
          mutation.agent,
          { userArgs: mutation.value },
          { target: 'legacy-permission', shell }
        )
      }
      if (!hasTypedAgentPermission(settings)) {
        throw new Error('This host stores permissions in launch arguments')
      }
      const lifted = liftAgentPermissionArgs(mutation.agent, mutation.value)
      return {
        agentDefaultArgs: normalizeTuiAgentArgsRecord({
          ...settings.agentDefaultArgs,
          [mutation.agent]: lifted.args
        }),
        ...(lifted.choice ? choiceUpdate(settings, mutation.agent, lifted.choice) : {})
      }
    }
    case 'environment-set':
    case 'environment-remove':
      return agentEnvironmentMutationUpdates(settings, mutation, platform)
  }
}
