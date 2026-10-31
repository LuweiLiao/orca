import { expect, it, vi } from 'vitest'
import { createAgentModelCatalogService } from './agent-model-catalog-service'
import { AgentModelCatalogStore, type AgentModelCatalogSuccess } from './agent-model-catalog-store'

it.each(['claude', 'codex'])(
  'uses the %s account list while a new folder loads, without adopting its defaults',
  async (agent) => {
    const store = new AgentModelCatalogStore()
    let accountPath = '/account'
    let resolveFolder: (value: AgentModelCatalogSuccess) => void = () => {}
    const folderListing = new Promise<AgentModelCatalogSuccess>((resolve) => {
      resolveFolder = resolve
    })
    const probe = Object.assign(
      vi.fn(async (_home, options) =>
        options?.workspacePath === '/new-project'
          ? folderListing
          : {
              models: [
                { id: 'account-a', label: 'Account A', isDefault: true, efforts: [] },
                { id: 'account-b', label: 'Account B', isDefault: false, efforts: [] }
              ],
              origin: 'probe' as const,
              complete: true
            }
      ),
      {
        resolve: async (_home, cwd) => ({
          identity: 'cli',
          run: async () => probe(_home, { workspacePath: cwd })
        })
      }
    )
    const service = createAgentModelCatalogService({
      store,
      getRecord: () => undefined,
      drivesRecord: () => true,
      resolveAccountHome: async () => ({
        variable: agent === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR',
        path: accountPath
      }),
      probes: { [agent]: probe },
      hasChatRecords: () => true
    })
    await service.read({ agent, waitForListing: true })
    const provisional = await service.read({ agent, workspacePath: '/new-project' })
    if (provisional.origin === 'unknown') {
      throw new Error('Account list missing')
    }
    expect(provisional.models?.map((model) => model.id)).toEqual(['account-a', 'account-b'])
    expect(provisional.models?.some((model) => model.isDefault)).toBe(false)
    accountPath = '/another-account'
    expect(await service.read({ agent, workspacePath: '/new-project' })).toMatchObject({
      origin: 'unknown'
    })
    accountPath = '/account'
    resolveFolder({
      models: [{ id: 'project-only', label: 'Project', isDefault: true, efforts: [] }],
      origin: 'probe',
      complete: true
    })
    const final = await service.read({ agent, workspacePath: '/new-project', waitForListing: true })
    if (final.origin === 'unknown') {
      throw new Error('Project list missing')
    }
    expect(final.models?.map((model) => model.id)).toEqual(['project-only'])
    service.stop()
  }
)
