import { removeAgentArgOption } from './agent-session-option-agent-args'
import type { AgentSessionOptionCatalog } from './agent-session-option-catalog-types'

/** Pi resolves a model by its `provider/id` selector; a bare id can match several providers. */
export function isPiModelSelector(value: string): boolean {
  const slash = value.indexOf('/')
  return slash > 0 && slash < value.length - 1 && !/\s/.test(value)
}

// Why: launch-only, like OpenCode's. A Pi chat lists its models over RPC, so a terminal catalog
// here would add a second model picker that can drift from the one the session reports.
export const PI_LAUNCH_OPTION_CATALOG: AgentSessionOptionCatalog = {
  supportsWorkerLaunchPreferences: true,
  models: [],
  modelApply: {
    launchArgs: (value) => ['--model', String(value)],
    removeAgentArgs: (tokens) => removeAgentArgOption('pi', tokens, ['--model'])
  }
}
