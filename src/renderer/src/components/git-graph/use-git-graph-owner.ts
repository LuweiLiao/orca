import { useCallback, useEffect, useState } from 'react'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import type { RuntimeGitContext } from '@/runtime/runtime-git-client-context'
import { translate } from '@/i18n/i18n'
import { resolveGitGraphOwner, type GitGraphOwner, type GitGraphOwnerFile } from './git-graph-owner'

// Why: owner resolution scans workspace catalogs; skip store writes that cannot change it.
const OWNER_INPUT_KEYS = [
  'settings',
  'repos',
  'worktreesByRepo',
  'detectedWorktreesByRepo',
  'folderWorkspaces',
  'floatingWorkspacePath',
  'projectGroups',
  'activeWorktreeId',
  'activeWorkspaceExecutionHostId',
  'restoredRuntimeHostIdByWorkspaceSessionKey',
  'runtimeEnvironments',
  'runtimeEnvironmentCatalogHydrated',
  'removedRuntimeEnvironmentIds',
  'sshConnectionStates',
  'sshStateByEnvironment'
] as const satisfies readonly (keyof AppState)[]

function ownerInputsChanged(state: AppState, previous: AppState): boolean {
  return OWNER_INPUT_KEYS.some((key) => state[key] !== previous[key])
}

export function useGitGraphOwner(file: GitGraphOwnerFile): {
  owner: GitGraphOwner
  resolveContext: () => RuntimeGitContext
} {
  const [owner, setOwner] = useState(() => resolveGitGraphOwner(useAppStore.getState(), file))
  useEffect(() => {
    const sync = (state: AppState): void => {
      const next = resolveGitGraphOwner(state, file)
      setOwner((previous) => (previous.key === next.key ? previous : next))
    }
    sync(useAppStore.getState())
    return useAppStore.subscribe((state, previous) => {
      if (ownerInputsChanged(state, previous)) {
        sync(state)
      }
    })
  }, [file])

  const ownerKey = owner.key
  // Why: re-verify at request time; connection generations move without a store write.
  const resolveContext = useCallback((): RuntimeGitContext => {
    const current = resolveGitGraphOwner(useAppStore.getState(), file)
    if (current.status === 'unavailable') {
      throw new Error(current.message)
    }
    if (current.status !== 'ready' || current.key !== ownerKey) {
      throw new Error(
        translate(
          'auto.components.gitGraph.owner.changed',
          'The workspace host changed. Reopen Git Graph for this workspace.'
        )
      )
    }
    return current.context
  }, [file, ownerKey])

  return { owner, resolveContext }
}
