import type { GlobalSettings } from './global-settings-types'
import type { TuiAgent } from './tui-agent'
import type { AgentLaunchChoices, AgentChoicePatch } from './agent-launch-choices'
import type { AgentPermissionChoice } from './tui-agent-permission-choice'
import type { AgentPermissionMode } from './tui-agent-permissions'

export type AgentLaunchSettingsSource = Partial<
  Pick<
    GlobalSettings,
    | 'defaultTuiAgent'
    | 'newWorkspaceSetupOnly'
    | 'disabledTuiAgents'
    | 'agentCmdOverrides'
    | 'agentLaunchChoices'
    | 'agentDefaultArgs'
    | 'agentDefaultEnv'
    | 'agentPermissionDefault'
    | 'agentPermissionOverrides'
    | 'nativeChatPermissionMode'
    | 'agentNativeChatPermissionModes'
    | 'terminalWindowsShell'
  >
>

export type AgentLaunchSettings = {
  defaultTuiAgent: GlobalSettings['defaultTuiAgent']
  newWorkspaceSetupOnly?: boolean
  disabledTuiAgents: TuiAgent[]
  agentCmdOverrides: NonNullable<GlobalSettings['agentCmdOverrides']>
  agentDefaultArgs: NonNullable<GlobalSettings['agentDefaultArgs']>
  environmentNames: Partial<Record<TuiAgent, string[]>>
  permissionMode: Exclude<AgentPermissionMode, 'auto'>
  autoPermissionMode?: true
  /** With Auto on: the combined mode of agents Auto doesn't cover. Absent from older hosts. */
  nonAutoPermissionMode?: 'manual' | 'yolo' | 'mixed'
  /** Stored permission and user Arguments exclude Orca flags; agentDefaultArgs retains them for older clients. Absent on hosts storing permissions as text. */
  agentChoices?: { defaults: AgentLaunchChoices; userArgs: Partial<Record<TuiAgent, string>> }
  agentPermission?: {
    default: AgentPermissionChoice
    overrides: Partial<Record<TuiAgent, AgentPermissionChoice>>
    userArgs: Partial<Record<TuiAgent, string>>
  }
}
export type AgentLaunchSettingsMutation =
  | { type: 'default'; agent: GlobalSettings['defaultTuiAgent']; setupOnly?: boolean }
  | { type: 'availability'; agent: TuiAgent; enabled: boolean }
  | {
      type: 'permissions'
      mode: Exclude<AgentPermissionMode, 'mixed'>
      agent?: TuiAgent
      /** Change only agents Auto doesn't cover. Sent only to hosts with the Auto capability. */
      exceptAuto?: true
      syncNativeChat?: true
    }
  /** Hosts with the stored permission. No agent: all agents; `withoutAuto`: agents without Auto. */
  | {
      type: 'permission'
      choice: AgentPermissionChoice | 'default'
      agent?: TuiAgent
      withoutAuto?: true
    }
  | { type: 'command'; agent: TuiAgent; value: string }
  /** The whole terminal text, flag included, as older clients see it. */
  | { type: 'arguments'; agent: TuiAgent; value: string }
  /** Only the user's own text; a permission flag Orca recognizes in it becomes the choice. */
  | { type: 'user-arguments'; agent: TuiAgent; value: string }
  | { type: 'launch-choices'; agent: TuiAgent; patch?: AgentChoicePatch; userArgs?: string }
  | { type: 'environment-set'; agent: TuiAgent; name: string; value: string }
  | { type: 'environment-remove'; agent: TuiAgent; name: string }
