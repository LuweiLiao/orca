import type { EffortLevel } from '@anthropic-ai/claude-agent-sdk'
import { decodeStructuredAgentSessionOptionValue } from '../../shared/structured-agent-session-option-codec'
import type {
  ClaudeStructuredLaunch,
  ClaudeStructuredSdkOptions
} from './claude-structured-launch-resolution'
import type { ClaudeSession } from './claude-structured-session-state'
import { restoredClaudeStructuredSessionOptions } from './claude-structured-options'
import { claudeChatCapabilitySettings } from './claude-chat-capabilities'
import { CHAT_CAPABILITIES_OPTION } from '../../shared/agent-session-chat-capabilities'

const EFFORT_LEVELS: ReadonlySet<string> = new Set<EffortLevel>([
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
])
/** Saved choices replace configured flags so the CLI receives each flag once. */
function withoutConfiguredFlag(
  options: ClaudeStructuredSdkOptions,
  flag: string
): ClaudeStructuredSdkOptions {
  if (!options.extraArgs || !Object.hasOwn(options.extraArgs, flag)) {
    return options
  }
  const { [flag]: _configured, ...extraArgs } = options.extraArgs
  return { ...options, extraArgs }
}

function isEffortLevel(value: string): value is EffortLevel {
  return EFFORT_LEVELS.has(value)
}

export type ClaudeStructuredSpawnOptions = {
  sdkOptions: ClaudeStructuredSdkOptions
  options: Map<string, string>
  /** Saved Fast must be applied before input when launch settings cannot carry it. */
  fastModeAtStart: boolean
}

/** Pass SDK-valid saved choices through; let the installed CLI reject unsupported values. */
export function claudeStructuredSpawnOptions(input: {
  launch: Pick<ClaudeStructuredLaunch, 'options' | 'resumesTranscript'>
  saved: Readonly<Record<string, string>> | undefined
}): ClaudeStructuredSpawnOptions {
  const saved = restoredClaudeStructuredSessionOptions(input.saved)
  const options = new Map<string, string>()
  let sdkOptions: ClaudeStructuredSdkOptions = { ...input.launch.options }
  let fastModeAtStart = false
  const model = saved.get('model')
  if (model !== undefined) {
    options.set('model', model)
    sdkOptions = { ...withoutConfiguredFlag(sdkOptions, 'model'), model }
  }
  const effort = saved.get('effort')
  if (effort !== undefined) {
    if (isEffortLevel(effort)) {
      options.set('effort', effort)
      sdkOptions = { ...withoutConfiguredFlag(sdkOptions, 'effort'), effort }
    }
  }
  const fastMode = saved.get('fastMode')
  if (fastMode !== undefined) {
    const decoded = decodeStructuredAgentSessionOptionValue('fastMode', fastMode)
    if (typeof decoded === 'boolean') {
      options.set('fastMode', fastMode)
      // New sessions may require Fast opt-in before input; explicit --settings must remain intact.
      if (
        (!decoded || input.launch.resumesTranscript) &&
        !Object.hasOwn(sdkOptions.extraArgs ?? {}, 'settings')
      ) {
        sdkOptions.settings = { fastMode: decoded }
      } else {
        fastModeAtStart = true
      }
    }
  }
  const capabilities = saved.get(CHAT_CAPABILITIES_OPTION)
  if (capabilities !== undefined) {
    options.set(CHAT_CAPABILITIES_OPTION, capabilities)
    if (
      typeof sdkOptions.settings !== 'string' &&
      !Object.hasOwn(sdkOptions.extraArgs ?? {}, 'settings')
    ) {
      sdkOptions.settings = {
        ...sdkOptions.settings,
        ...claudeChatCapabilitySettings(capabilities)
      }
    } else {
      const selected = claudeChatCapabilitySettings(capabilities)
      if (Object.keys(selected.skillOverrides ?? {}).length || selected.deniedMcpServers?.length) {
        throw new Error(
          'Conversation Skill/MCP selection cannot override an explicit --settings file. Remove the --settings argument or enable all capabilities for this conversation.'
        )
      }
    }
  }
  return { sdkOptions, options, fastModeAtStart }
}

export function adoptClaudeStructuredSpawnOptions(
  session: Pick<
    ClaudeSession,
    'translator' | 'launchedModel' | 'fastModeAtStart' | 'appliedInputOptions'
  >,
  spawn: Pick<ClaudeStructuredSpawnOptions, 'options' | 'fastModeAtStart'>
): void {
  session.launchedModel = spawn.options.get('model') ?? null
  session.fastModeAtStart = spawn.fastModeAtStart
  const fastMode = spawn.options.get('fastMode')
  if (fastMode !== undefined && !spawn.fastModeAtStart) {
    session.appliedInputOptions.set('fastMode', fastMode)
  }
  const model = spawn.options.get('model')
  if (model !== undefined) {
    session.translator?.modelWritten(model)
  }
}
