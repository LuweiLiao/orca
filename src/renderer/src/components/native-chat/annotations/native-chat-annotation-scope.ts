import type { RuntimeClientTarget } from '../../../../../shared/remote-runtime/host-catalog/runtime-client-target'

/** One structured conversation's annotations, shared by every pane that shows it. */
export function structuredNativeChatAnnotationScopeKey(
  target: RuntimeClientTarget,
  sessionId: string
): string {
  return JSON.stringify(['structured', target, sessionId])
}

/** A terminal pane's chat keeps its annotations per agent session in that pane's runtime. */
export function terminalNativeChatAnnotationScopeKey(
  runtimeEnvironmentId: string | null | undefined,
  agent: string,
  sessionId: string | null | undefined
): string {
  return JSON.stringify(['terminal', runtimeEnvironmentId, agent, sessionId])
}
