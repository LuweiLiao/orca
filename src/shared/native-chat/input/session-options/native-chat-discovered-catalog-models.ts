import { createClaudeCatalogOptions } from '../../../agent-session/options/catalog-providers/agent-session-option-catalog-claude-codex'
import {
  getAgentSessionOptionCatalog,
  mergeCatalogModels,
  mergeDiscoveredAuthoritativeModels
} from '../../../agent-session/options/agent-session-option-catalog'
import type {
  AgentSessionOptionCatalog,
  CatalogModel
} from '../../../agent-session/options/catalog-providers/agent-session-option-catalog-types'
import type { AgentType } from '../../../agent-status/contracts/agent-status-types'
import { isClaudeLauncherAgent } from '../../../agent-launch/catalog/claude-cli-launch-agents'
import type { CommitMessageModelCapability } from '../../../source-control/ai/generation/commit-message-agent-spec'

export type NativeChatModelDiscoveryResult =
  | {
      success: true
      models: readonly CommitMessageModelCapability[]
      /** Missing only when an older remote runtime produced the response. */
      catalogOrigin?: 'probe' | 'spec'
    }
  | { success: false }

/** Claude and the launchers (ccb) that run its CLI list Claude's models. */
const listsClaudeModels = (agent: AgentType): boolean =>
  agent === 'claude' || isClaudeLauncherAgent(agent)

/** The host's CLI model listing as picker models, or null when it cannot stand in for the catalog. */
export function catalogModelsFromModelDiscovery(
  agent: AgentType,
  result: NativeChatModelDiscoveryResult
): CatalogModel[] | null {
  if (
    !result.success ||
    result.models.length === 0 ||
    // Static fallback lists cannot stand in for the host's authoritative inventory.
    ((listsClaudeModels(agent) ||
      getAgentSessionOptionCatalog(agent)?.discoveredModelsAreAuthoritative) &&
      result.catalogOrigin !== 'probe')
  ) {
    return null
  }
  return result.models.map((model) => ({
    id: model.id,
    label: model.label,
    ...(model.description ? { description: model.description } : {}),
    ...(model.isDefault ? { isDefault: true as const } : {}),
    ...(model.contextWindowTokens ? { contextWindowTokens: model.contextWindowTokens } : {}),
    ...(model.resolvedModel ? { resolvedModel: model.resolvedModel } : {}),
    options: listsClaudeModels(agent)
      ? createClaudeCatalogOptions({
          effortLevelIds: model.thinkingLevels?.map(({ id }) => id) ?? [],
          supportsFastMode: model.supportsFastMode
        })
      : []
  }))
}

/** Discovered models as the picker lists them: Claude's own, or merged with the seed so its option menus stay. */
export function mergeDiscoveredCatalogModels(
  agent: AgentType,
  catalog: AgentSessionOptionCatalog | null | undefined,
  discovered: readonly CatalogModel[]
): CatalogModel[] {
  if (listsClaudeModels(agent) || !catalog) {
    return [...discovered]
  }
  return catalog.discoveredModelsAreAuthoritative
    ? mergeDiscoveredAuthoritativeModels(catalog.models, discovered)
    : mergeCatalogModels(catalog.models, discovered)
}
