import { withCliRuntimeOnPath } from '../../shared/node-cli-command-resolution'
import { applyClaudeEnvPatch } from '../claude-accounts/environment'
import { resolveClaudeCommand, resolveCliCommand } from '../codex-cli/command'
import type { ClaudeLauncherAgent } from '../../shared/claude-cli-launch-agents'
import { resolveAgainAfterRefreshOnMissingProgram } from '../native-chat/structured-agent-command-resolution'
import { withoutInheritedClaudeConfigDir } from './claude-config-dir-pin'

function cloneDefinedEnv(env: NodeJS.ProcessEnv | Record<string, string>): Record<string, string> {
  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      next[key] = value
    }
  }
  return next
}

export type ClaudeCommandLookup = {
  pathEnv?: string | null
  homePath?: string
  /** A launcher such as ccb that runs Claude for this chat; absent for native Claude. */
  launcher?: ClaudeLauncherAgent
}

export type ClaudeEnvDeps = {
  resolveCommand?: (options?: ClaudeCommandLookup) => string
  /** The chat's launcher, read from its saved options. */
  launcher?: ClaudeLauncherAgent
  /** Refresh once after command lookup misses; absent disables retry. */
  refreshEnvironmentAfterMiss?: (askedAt: number) => Promise<void>
  /** Cwd used to resolve relative PATH entries; defaults to Orca's cwd. */
  resolveWorkingDirectory?: () => Promise<string> | string
  resolveEnv?: () =>
    | Promise<Record<string, string> | undefined>
    | Record<string, string>
    | undefined
  /** Inherited environment before auth policy; defaults to Orca's process environment. */
  resolveInheritedEnv?: () => Promise<Record<string, string>>
}

export type ClaudeChildEnvSources = {
  command: string
  overlay: Record<string, string> | undefined
  inheritedEnv: Record<string, string>
}

export function resolveClaudeChildEnvSources(deps: ClaudeEnvDeps): Promise<ClaudeChildEnvSources> {
  return resolveAgainAfterRefreshOnMissingProgram(
    () => readClaudeChildEnvSources(deps),
    deps.refreshEnvironmentAfterMiss,
    {
      env: ({ inheritedEnv, overlay }) => ({ ...inheritedEnv, ...overlay }),
      cwd: deps.resolveWorkingDirectory
    }
  )
}

async function readClaudeChildEnvSources(deps: ClaudeEnvDeps): Promise<ClaudeChildEnvSources> {
  const overlay = await deps.resolveEnv?.()
  const inheritedEnv = deps.resolveInheritedEnv
    ? await deps.resolveInheritedEnv()
    : cloneDefinedEnv(process.env)
  const effectiveEnv = { ...inheritedEnv, ...overlay }
  const lookup = {
    pathEnv: effectiveEnv.PATH ?? effectiveEnv.Path ?? null,
    homePath: effectiveEnv.HOME ?? effectiveEnv.USERPROFILE
  }
  const command = deps.resolveCommand
    ? deps.resolveCommand(deps.launcher ? { ...lookup, launcher: deps.launcher } : lookup)
    : deps.launcher
      ? resolveCliCommand(deps.launcher, lookup)
      : resolveClaudeCommand(lookup)
  return { command, overlay: overlay ? cloneDefinedEnv(overlay) : undefined, inheritedEnv }
}

// Merge onto the shell environment to retain PATH and ambient Anthropic auth.
export function claudeChildEnv(
  sources: ClaudeChildEnvSources,
  decorateEnv: (env: Record<string, string>) => Record<string, string> = (env) => env,
  /** False when the session's seal pairs the CLI runtime itself, behind this app's CLI. */
  { runtimeOnPath = true }: { runtimeOnPath?: boolean } = {}
): Record<string, string> {
  const env = decorateEnv({
    ...withoutInheritedClaudeConfigDir(sources.inheritedEnv, process.platform),
    ...sources.overlay
  })
  return runtimeOnPath
    ? withCliRuntimeOnPath(sources.command, env, { platform: process.platform })
    : env
}

// Version probes need the launch runtime and PATH, without auth credentials.
export function claudeProbeEnv(sources: ClaudeChildEnvSources): Record<string, string> {
  return applyClaudeEnvPatch(
    claudeChildEnv(sources),
    {},
    {
      stripAuthEnv: true,
      platform: process.platform
    }
  )
}
