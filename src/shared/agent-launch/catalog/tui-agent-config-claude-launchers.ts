import type { ClaudeLauncherAgent } from './claude-cli-launch-agents'
import type { TuiAgentConfigSource } from './tui-agent-config-types'

// Why: ccb forwards Claude's argv to the official binary; `--` keeps prompts off ccb subcommands.
export const CLAUDE_LAUNCHER_CONFIG_SOURCE: Record<ClaudeLauncherAgent, TuiAgentConfigSource> = {
  ccb: {
    detectCmd: 'ccb',
    expectedProcess: 'claude',
    promptInjectionMode: 'argv',
    argvPromptSeparator: '--',
    pasteNeedsTypedRequest: true,
    draftPromptFlag: '--prefill',
    preflightTrust: 'claude'
  }
}
