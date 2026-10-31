import { independentAgentModelCatalog } from './agent-model-catalog-discovery'
import { agentModelCatalogListingKey } from './agent-model-catalog-entry'
import type { AgentModelCatalogService } from './agent-model-catalog-service-contract'
import type { AgentModelCatalogStore } from './agent-model-catalog-store'

export function seedAccountModelCatalog(
  store: AgentModelCatalogStore,
  params: Parameters<AgentModelCatalogService['read']>[0],
  scope: { base: string; fingerprint: string; exact: boolean },
  stopped: boolean
): void {
  if (
    stopped ||
    !scope.exact ||
    params.sessionId ||
    params.workspacePath !== undefined ||
    params.savedOnly ||
    params.legacy ||
    !independentAgentModelCatalog(params.agent)
  ) {
    return
  }
  const entry = store.get(scope.fingerprint)
  if (entry?.discovered?.complete !== true || !store.verified(entry)) {
    return
  }
  const discovered = {
    ...entry.discovered,
    models: entry.discovered.models.map(({ defaultEffort: _effort, ...model }) => ({
      ...model,
      isDefault: false
    }))
  }
  const previous = store.get(scope.base)
  if (
    !previous ||
    agentModelCatalogListingKey(previous) !==
      agentModelCatalogListingKey({
        ...entry,
        discovered,
        live: null,
        configured: null
      })
  ) {
    store.recordSuccess(scope.base, params.agent, discovered, 'discovery')
  }
}
