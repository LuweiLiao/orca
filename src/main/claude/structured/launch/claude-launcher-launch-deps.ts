import {
  claudeLauncherFromOptions,
  type ClaudeLauncherAgent
} from '../../../../shared/agent-launch/catalog/claude-cli-launch-agents'
import type { ClaudeStructuredLaunchPartDeps } from './claude-structured-launch-resolution'

/** What a chat's launcher (ccb) changes about its launch: the env fragment, and deps without version-gated flags. */
export function claudeLauncherLaunchDeps(
  deps: ClaudeStructuredLaunchPartDeps,
  options: Readonly<Record<string, string>> | null | undefined
): {
  envPatch: { launcher?: ClaudeLauncherAgent }
  flagDeps: ClaudeStructuredLaunchPartDeps
} {
  const launcher = claudeLauncherFromOptions(options)
  // Why: probing `--version` through a launcher leaves a profile init lock if killed, so it gets no version-gated flags.
  return launcher
    ? { envPatch: { launcher }, flagDeps: { ...deps, cliFlags: undefined } }
    : { envPatch: {}, flagDeps: deps }
}
