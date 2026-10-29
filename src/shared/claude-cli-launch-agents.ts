import type { TuiAgent } from './tui-agent'

/** Agents whose terminal launch runs the official Claude Code CLI under another entry point. */
const CLAUDE_CLI_LAUNCH_AGENTS: ReadonlySet<string> = new Set<TuiAgent>([
  'claude',
  'claude-agent-teams',
  'ccb'
])

export type ClaudeLauncherAgent = Extract<TuiAgent, 'ccb'>

/** Launchers whose sessions report Claude's own identity through hooks and the process table. */
const CLAUDE_LAUNCHER_AGENTS: ReadonlySet<string> = new Set<ClaudeLauncherAgent>(['ccb'])

/** A structured Claude chat's create-only option naming the launcher that starts its CLI. */
export const CLAUDE_LAUNCHER_OPTION_ID = 'launcher'

// Why: an older host refuses the launcher option, so a client offers a launcher's chat only to a
// host advertising this; elsewhere the launcher opens in a terminal.
export const CLAUDE_LAUNCHER_RUNTIME_CAPABILITY = 'agent-session.claude-launcher.v1' as const

export function runsClaudeCodeCli(agent: string | null | undefined): boolean {
  return agent != null && CLAUDE_CLI_LAUNCH_AGENTS.has(agent)
}

/** Whether a `claude` signal belongs to this launcher owner rather than to native Claude. */
export function isClaudeLauncherAgent(
  agent: string | null | undefined
): agent is ClaudeLauncherAgent {
  return agent != null && CLAUDE_LAUNCHER_AGENTS.has(agent)
}

/** Options a provider accepts only when a chat is created, never as a later pick; an unknown
 *  launcher stays in so the provider's own option check refuses it. */
export function withoutCreateOnlyOptions(
  provider: string,
  options: Readonly<Record<string, string>>
): Readonly<Record<string, string>> {
  if (provider !== 'claude' || !isClaudeLauncherAgent(options[CLAUDE_LAUNCHER_OPTION_ID])) {
    return options
  }
  const { [CLAUDE_LAUNCHER_OPTION_ID]: _launcher, ...rest } = options
  return rest
}

/** The structured provider a picker agent creates its chat as, and the options that carry its
 *  launcher. A launcher's chat is a Claude chat, so transcripts, resume and rewind stay Claude's. */
export function structuredLaunchProviderFor<T extends string>(
  agent: T
): { agent: T | 'claude'; launcherOptions?: Readonly<Record<string, string>> } {
  return isClaudeLauncherAgent(agent)
    ? { agent: 'claude', launcherOptions: { [CLAUDE_LAUNCHER_OPTION_ID]: agent } }
    : { agent }
}

type Options = Readonly<Record<string, string>>

/** A create's options over the saved selection: the user's picks as `applyPicks` merges them, then
 *  the launcher, so a create naming only its launcher keeps the saved selection. */
export function mergeCreateOptions(
  provider: string,
  options: Options | undefined,
  saved: Options | undefined,
  applyPicks: (picks: Options) => Options
): Options | undefined {
  if (!options) {
    return saved
  }
  const picks = withoutCreateOnlyOptions(provider, options)
  const chosen = Object.keys(picks).length > 0 ? applyPicks(picks) : saved
  const launcher = picks === options ? undefined : claudeLauncherOptionsOf(options)
  return launcher ? { ...chosen, ...launcher } : chosen
}

/** Only the launcher entry of a chat's options, for a retry that rebuilds its create. */
export function claudeLauncherOptionsOf(
  options: Readonly<Record<string, string>> | null | undefined
): Readonly<Record<string, string>> | undefined {
  const launcher = claudeLauncherFromOptions(options)
  return launcher ? { [CLAUDE_LAUNCHER_OPTION_ID]: launcher } : undefined
}

/** The launcher a structured Claude chat's saved options name, or null for native Claude. */
export function claudeLauncherFromOptions(
  options: Readonly<Record<string, string>> | null | undefined
): ClaudeLauncherAgent | null {
  const launcher = options?.[CLAUDE_LAUNCHER_OPTION_ID]
  return isClaudeLauncherAgent(launcher) ? launcher : null
}
