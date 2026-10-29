import type { CanUseTool, OnUserDialog, PermissionResult } from '@anthropic-ai/claude-agent-sdk'
import type { ClaudePromptRegistry } from './claude-structured-prompt-replies'
import type { ClaudeStructuredSdkOptions } from './claude-structured-launch-resolution'
import type { ClaudeStructuredSessionEvent } from './claude-structured-session-state'
import {
  claudePermissionPresentation,
  claudePermissionSubject
} from './claude-permission-presentation'

export type ClaudePermissionCallbackDeps = {
  sessionId: string
  prompts: ClaudePromptRegistry
  emit: (event: ClaudeStructuredSessionEvent) => void
}

// Why: these need the user's answer, not permission, so full access still shows them.
const USER_ANSWERED_TOOLS: ReadonlySet<string> = new Set(['AskUserQuestion', 'ExitPlanMode'])

/** --dangerously-skip-permissions still asks on Claude's safety checks (e.g. variable-path rm). */
export function claudeFullAccessCanUseTool(
  canUseTool: CanUseTool,
  options: Pick<ClaudeStructuredSdkOptions, 'extraArgs'>
): CanUseTool {
  if (!Object.hasOwn(options.extraArgs ?? {}, 'dangerously-skip-permissions')) {
    return canUseTool
  }
  return (toolName, input, request) =>
    // A matched ask rule is the user's own request for a human prompt.
    request.matchedAskRule || USER_ANSWERED_TOOLS.has(toolName)
      ? canUseTool(toolName, input, request)
      : Promise.resolve({ behavior: 'allow', updatedInput: input, toolUseID: request.toolUseID })
}

function denySafeResult(toolUseId: string | undefined): PermissionResult {
  return {
    behavior: 'deny',
    message: 'Orca could not decode this permission request.',
    ...(toolUseId ? { toolUseID: toolUseId } : {})
  }
}

/** Malformed requests are denied; provider cancellation forgets the callback without replying. */
export function buildClaudePermissionCallbacks(deps: ClaudePermissionCallbackDeps): {
  canUseTool: CanUseTool
  onUserDialog: OnUserDialog
} {
  const canUseTool: CanUseTool = (toolName, input, options) =>
    new Promise<PermissionResult | null>((resolve) => {
      let cancel = (): void => {}
      const settle = (response: PermissionResult | null): void => {
        options.signal.removeEventListener('abort', cancel)
        resolve(response)
      }
      const subject = claudePermissionSubject(toolName, input)
      const prompt = deps.prompts.register({
        ...claudePermissionPresentation(options),
        ...(subject ? { subject } : {}),
        requestId: options.requestId,
        toolName,
        toolUseId: options.toolUseID,
        input,
        suggestions: options.suggestions ?? [],
        settle,
        ...(options.agentID ? { agentId: options.agentID } : {})
      })
      if (!prompt) {
        settle(denySafeResult(options.toolUseID))
        return
      }
      cancel = (): void => {
        if (deps.prompts.forgetIfPending(prompt)) {
          deps.emit({
            type: 'prompt-cancelled',
            sessionId: deps.sessionId,
            promptKey: prompt.promptKey
          })
          // Null tells the SDK to write no response to the cancelled request.
          settle(null)
        }
      }
      if (options.signal.aborted) {
        // Abort events are not replayed for listeners added after cancellation.
        cancel()
        return
      }
      options.signal.addEventListener('abort', cancel, { once: true })
      deps.emit({ type: 'prompt', sessionId: deps.sessionId, prompt })
    })

  const onUserDialog: OnUserDialog = () => Promise.resolve({ behavior: 'cancelled' })

  return { canUseTool, onUserDialog }
}
