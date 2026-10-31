import {
  removeOverriddenAgentSessionArgs,
  resolveAgentSessionOptionLaunch
} from './agent-session-option-launch'
import { resolveAgentChoiceLayers, yieldAgentChoicesToArgs } from './agent-choice-layers'
import { resolveTuiAgentLaunchRawArgs } from './tui-agent-launch-defaults'
import {
  hasExtraAgentArgs,
  parseExtraAgentArgs,
  mergeParsedExtraAgentArgs
} from './automation-extra-agent-args'
import type { AgentLaunchProfileSettings } from './tui-agent-launch-defaults'
import { readLaunchPermissionChoice } from './tui-agent-permission-choice'
import type { SessionOptionValue } from './native-chat-session-options'
import { agentArgTerminatorIndex } from './agent-session-option-agent-args'
import { getTuiAgentLaunchCommand, TUI_AGENT_CONFIG } from './tui-agent-config'
import {
  planAgentCliArgsSuffix,
  quoteStartupArg,
  tokenizeStartupCommand,
  type AgentStartupShell
} from './tui-agent-startup-shell'
import type { TuiAgent } from './tui-agent'

export type ResolvedAgentLaunchCommand =
  | {
      ok: true
      command: string
      commandWithoutSessionOptions: string
      appliedSessionOptions: Record<string, SessionOptionValue>
    }
  | { ok: false; error: string }

export function resolveAgentLaunchCommand(args: {
  agent: TuiAgent
  cmdOverrides: Partial<Record<TuiAgent, string>>
  platform: NodeJS.Platform
  shell: AgentStartupShell
  agentArgs?: string | null
  sessionOptions?: Record<string, SessionOptionValue>
  sessionOptionsOverrideAgentArgs?: boolean
  isRemote?: boolean
}): ResolvedAgentLaunchCommand {
  const override = args.cmdOverrides[args.agent]
  const command =
    override ||
    getTuiAgentLaunchCommand(TUI_AGENT_CONFIG[args.agent], args.platform, {
      isRemote: args.isRemote
    })
  const suffix = planAgentCliArgsSuffix(args.agentArgs, args.shell)
  if (!suffix.ok) {
    return suffix
  }
  const trailingTokens = args.agentArgs?.trim()
    ? tokenizeStartupCommand(args.agentArgs.trim(), args.shell)
    : { ok: true as const, tokens: [], spans: [] }
  if (!trailingTokens.ok) {
    return { ok: false, error: `CLI arguments are invalid: ${trailingTokens.error}` }
  }
  const resolvedOptions = resolveAgentSessionOptionLaunch(
    args.agent,
    args.sessionOptions,
    args.sessionOptionsOverrideAgentArgs ? [] : trailingTokens.tokens,
    !args.sessionOptionsOverrideAgentArgs
  )
  if (override && args.sessionOptionsOverrideAgentArgs) {
    const overrideTokens = tokenizeStartupCommand(override, args.shell)
    if (!overrideTokens.ok) {
      return { ok: false, error: `Agent command override is invalid: ${overrideTokens.error}` }
    }
    const commandOverrideOptions = resolveAgentSessionOptionLaunch(
      args.agent,
      args.sessionOptions,
      overrideTokens.tokens,
      false
    )
    if (
      Object.entries(resolvedOptions.appliedValues).some(
        ([key, value]) => commandOverrideOptions.appliedValues[key] !== value
      )
    ) {
      return {
        ok: false,
        error:
          'Agent command override conflicts with the requested launch preferences. Remove model or effort flags from the command override.'
      }
    }
  }
  const optionSuffix = resolvedOptions.args.map((arg) => quoteStartupArg(arg, args.shell)).join(' ')
  const commandWithoutSessionOptions = suffix.suffix ? `${command} ${suffix.suffix}` : command
  const commandWithOptions = optionSuffix ? `${command} ${optionSuffix}` : command
  const overrideTokens = args.sessionOptionsOverrideAgentArgs
    ? insertBeforeTerminator(
        args.agent,
        removeOverriddenAgentSessionArgs(args.agent, args.sessionOptions, trailingTokens.tokens),
        resolvedOptions.args
      )
    : []
  const commandWithOverrides = overrideTokens.length
    ? `${command} ${overrideTokens.map((token) => quoteStartupArg(token, args.shell)).join(' ')}`
    : command
  return {
    ok: true,
    command: args.sessionOptionsOverrideAgentArgs
      ? commandWithOverrides
      : suffix.suffix
        ? `${commandWithOptions} ${suffix.suffix}`
        : commandWithOptions,
    commandWithoutSessionOptions,
    appliedSessionOptions: resolvedOptions.appliedValues
  }
}

function insertBeforeTerminator(
  agent: TuiAgent,
  tokens: readonly string[],
  inserted: readonly string[]
): string[] {
  const terminator = agentArgTerminatorIndex(agent, tokens)
  return [...tokens.slice(0, terminator), ...inserted, ...tokens.slice(terminator)]
}

/** Resolve authored defaults against the original raw text before compiling either into argv. */
export function terminalSessionOptionInputs(args: {
  agent: TuiAgent
  settings?: AgentLaunchProfileSettings | null
  sessionOptions: Readonly<Record<string, SessionOptionValue>> | undefined
  yieldToAgentArgs?: boolean
  agentArgs: string | null | undefined
  shell: AgentStartupShell
  command?: string
  extraAgentArgs?: string
}): {
  agentArgs?: string | null
  sessionOptions?: Record<string, SessionOptionValue>
  sessionOptionsOverrideAgentArgs?: true
} {
  const permission = readLaunchPermissionChoice(args.sessionOptions)
  let raw =
    args.agentArgs === undefined
      ? resolveTuiAgentLaunchRawArgs(
          args.agent,
          args.settings,
          permission ? 'own' : undefined,
          args.shell
        )
      : args.agentArgs
  const extras = hasExtraAgentArgs(args.extraAgentArgs)
    ? parseExtraAgentArgs({ agent: args.agent, extraAgentArgs: args.extraAgentArgs })
    : undefined
  if (extras && !extras.ok) {
    throw new Error(extras.error)
  }
  if (extras?.ok) {
    const merged = mergeParsedExtraAgentArgs({
      agent: args.agent,
      defaultArgs: raw,
      extras,
      shell: args.shell
    })
    if (!merged.ok) {
      throw new Error(merged.error)
    }
    raw = merged.agentArgs
  }
  const authored = args.settings?.agentLaunchChoices?.[args.agent]
  let defaultValues = {
    ...authored?.options,
    ...(authored?.model ? { model: authored.model } : {})
  }
  if (Object.keys(defaultValues).length) {
    const command = tokenizeStartupCommand(args.command ?? '', args.shell)
    defaultValues = yieldAgentChoicesToArgs(args.agent, defaultValues, [
      ...(command.ok ? command.tokens : []),
      ...(extras?.ok ? extras.tokens : [])
    ])
  }
  const { model: defaultModel, ...defaultOptions } = defaultValues
  const choices = resolveAgentChoiceLayers({
    agent: args.agent,
    defaults: { ...(defaultModel ? { model: defaultModel } : {}), options: defaultOptions },
    action: args.sessionOptions
      ? {
          ...(typeof args.sessionOptions.model === 'string'
            ? { model: args.sessionOptions.model }
            : {}),
          options: Object.fromEntries(
            Object.entries(args.sessionOptions)
              .filter(([id]) => !['model', 'mode', 'permissionMode'].includes(id))
              .map(([id, value]) => [id, String(value)])
          ),
          ...(permission ? { permissionMode: permission } : {})
        }
      : undefined,
    argumentOwner: args.agentArgs === undefined ? 'defaults' : 'launch',
    userArgs: raw,
    launchPreferencesYieldToAgentArgs: args.yieldToAgentArgs,
    shell: args.shell
  })
  const sessionOptions = {
    ...choices.options,
    ...(choices.model ? { model: choices.model } : {}),
    ...(choices.permissionMode ? { permissionMode: choices.permissionMode } : {})
  }
  return {
    agentArgs: raw,
    ...(Object.keys(sessionOptions).length > 0
      ? { sessionOptions, sessionOptionsOverrideAgentArgs: true as const }
      : {})
  }
}
