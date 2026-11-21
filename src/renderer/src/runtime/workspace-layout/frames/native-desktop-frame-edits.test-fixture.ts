import { vi } from 'vitest'
import type { WorkspaceSessionState } from '../../../../../shared/workspace-session/workspace-session-state-types'
import { getRepoIdFromWorktreeId } from '../../../../../shared/worktree/id'
import type { AppState } from '../../../store/types'
import type { createTestStore } from '../../../store/testing/app-store-test-fixture'
import { fetchWorkspaceSessionWithRuntimeHostOwners } from '../../../lib/workspace/persistence/workspace-session-host-hydration'
import { collectFolderWorkspaceKeysFromSession } from '../../../lib/workspace/persistence/workspace-session-hydration-keys'
import { reconcileHydratedWorkspaceTabModels } from '../../../app-shell/startup/reconcile-hydrated-workspace-tab-models'

function localRepos(session: WorkspaceSessionState): AppState['repos'] {
  const repos = new Map<string, AppState['repos'][number]>()
  for (const key of Object.keys(session.tabsByWorktree)) {
    const id = getRepoIdFromWorktreeId(key)
    if (key.startsWith(`${id}::`) && !repos.has(id)) {
      repos.set(id, {
        id,
        path: key.slice(id.length + 2),
        displayName: id,
        badgeColor: '#000',
        addedAt: 0,
        connectionId: null,
        executionHostId: 'local'
      })
    }
  }
  return [...repos.values()]
}

/** Hydrates a test store from one local partition in the order app startup does. */
export async function bootLocalWindow(
  store: ReturnType<typeof createTestStore>,
  session: WorkspaceSessionState
): Promise<void> {
  let minted = 0
  const randomUUID = vi
    .spyOn(globalThis.crypto, 'randomUUID')
    .mockImplementation(() => `00000000-0000-4000-8000-${String(++minted).padStart(12, '0')}`)
  try {
    store.setState({ repos: localRepos(session) })
    const read = await fetchWorkspaceSessionWithRuntimeHostOwners(
      { get: async () => structuredClone(session), listHostIds: async () => [] },
      store.getState().repos
    )
    const actions = store.getState()
    const options = {
      additionalValidWorkspaceKeys: collectFolderWorkspaceKeysFromSession(read.session)
    }
    actions.hydrateWorkspaceSession(read.session, {
      ...options,
      runtimeHostIdByWorkspaceSessionKey: read.runtimeHostIdByWorkspaceSessionKey,
      contestedHostWorkspaceSessions: read.contestedHostWorkspaceSessions,
      contestedPrimaryHostBySessionKey: read.contestedPrimaryHostBySessionKey
    })
    actions.hydrateTabsSession(read.session, options)
    actions.hydrateEditorSession(read.session, options)
    actions.hydrateBrowserSession(read.session, options)
    reconcileHydratedWorkspaceTabModels(read.session, store.getState().reconcileWorktreeTabModels)
  } finally {
    randomUUID.mockRestore()
  }
}
