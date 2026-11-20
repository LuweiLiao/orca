import type { NativeChatDefaultSettings } from '../../shared/agent-launch/choices/structured-native-chat-launch-route'

export type AgentLaunchModeSettings = NativeChatDefaultSettings

/** A desktop stamp supplies its resolved preference for the launched agent; other callers read the host’s settings. */
export function readAgentLaunchModeSettings(
  runtime: { requireStore(): { getSettings(): AgentLaunchModeSettings | null } },
  caller?: { agent?: string; nativeChatDefault?: boolean }
): AgentLaunchModeSettings | null {
  if (caller?.nativeChatDefault !== undefined) {
    return caller.agent === undefined
      ? {}
      : { nativeChatProviders: { [caller.agent]: caller.nativeChatDefault } }
  }
  try {
    return runtime.requireStore().getSettings()
  } catch (error) {
    console.warn('[agent-launch] could not resolve chat preference', error)
    return null
  }
}
