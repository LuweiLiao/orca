import { readCallerStoreInstallationId } from '../../../hosts/platform-probe/host-descriptor'
import { getCanonicalUserDataPath } from '../../../../persistence/loading-store/user-data-path'
import { getLocalWorktreeCatalogVersion } from '../../../../workspaces/catalog/local-worktree-scan-generation'
import { getExplicitWorktreeIdSelector } from '../../../workspaces/catalog/runtime-worktree-selection'
import { splitWorktreeId } from '../../../../../shared/worktree/id'
import { defineMethod } from '../../core'
import { resolvePairedCallerHostId } from '../pairing/paired-caller-host-id'
import { resolveRuntimeNavigationTarget } from '../../../../../shared/remote-runtime/session-graph/runtime-navigation'
import { WorktreePrefetchCreateBase } from '../../../../../shared/rpc-contract/workspaces/worktree-create-params'
import { WORKTREE_CREATE_METHOD } from './worktree-create-method'
import {
  WorktreeActivate,
  WorktreeForceDeleteBranch,
  WorktreeRemove,
  WorktreePreviewNestedRemoval,
  WorktreeResolveMrBase,
  WorktreeResolvePrBase,
  WorktreeRunApprovedSetup,
  WorktreeShow,
  WorktreeSortOrder,
  WorktreeTeardownMissingTerminalsParams,
  WorktreeResolveCallerParent
} from '../../../../../shared/rpc-contract/workspaces/worktree-params'
import { WORKTREE_CATALOG_METHODS } from './worktree-catalog-methods'
import { WORKTREE_PROVISIONED_ROOT_METHOD } from './worktree-provisioned-root-method'
import { waitsForWorktreeRemoval } from '../../workspace-client-views/worktree-removal-marker-projection'
import { queueWorkspaceDelete } from '../../../workspaces/lifecycle/workspace-lifecycle-commands'
import { WORKTREE_SLEEP_METHOD } from './worktree-sleep-method'
import { WORKSPACE_CLEANUP_SCAN_METHOD } from './workspace-cleanup-scan-method'
import { WORKTREE_SET_METHOD } from './worktree-set-method'
import { runApprovedCreatedWorktreeSetup } from '../../../workspaces/creation/created-worktree-approved-setup'

export const WORKTREE_METHODS = [
  ...WORKTREE_CATALOG_METHODS,
  defineMethod({
    name: 'worktree.teardownMissingTerminals',
    permission: 'workspace',
    params: WorktreeTeardownMissingTerminalsParams,
    handler: async (params, { runtime }) =>
      runtime.teardownMissingManagedWorktreeTerminals(
        params.repo,
        params.worktreeIds,
        params.connectionId
      )
  }),
  defineMethod({
    name: 'worktree.runApprovedSetup',
    permission: 'workspace',
    params: WorktreeRunApprovedSetup,
    handler: async (params, { runtime }) =>
      runApprovedCreatedWorktreeSetup(runtime, params.worktree, params.approvedSetupHash, {
        wslUserAct: true
      })
  }),
  defineMethod({
    name: 'worktree.lineageList',
    permission: 'workspace',
    params: null,
    handler: async (_params, { runtime }) => ({
      lineage: await runtime.listWorktreeLineage(),
      workspaceLineage: await runtime.listWorkspaceLineage(),
      // Older desktops ignore it, so these children stay standalone there.
      crossStoreLineage: runtime.listCrossStoreLineage(),
      // Paired clients name this store by it when linking a child on another machine.
      installationId: await runtime.readStoreInstallationId()
    })
  }),
  defineMethod({
    name: 'worktree.resolveCallerParent',
    permission: 'workspace',
    params: WorktreeResolveCallerParent,
    handler: async (params, { runtime }) =>
      await runtime.resolveCallerParentForAnotherStore(
        params,
        await readCallerStoreInstallationId(runtime.getRuntimeId(), getCanonicalUserDataPath())
      )
  }),
  defineMethod({
    name: 'worktree.show',
    permission: 'workspace',
    params: WorktreeShow,
    handler: async (params, { runtime }) => ({
      worktree: await runtime.showManagedWorktree(params.worktree, undefined, {
        matchFolders: params.matchFolderWorkspaces === true
      })
    })
  }),
  WORKTREE_SLEEP_METHOD,
  WORKSPACE_CLEANUP_SCAN_METHOD,
  defineMethod({
    name: 'worktree.activate',
    permission: 'workspace',
    params: WorktreeActivate,
    handler: async (params, { runtime, clientKind }) =>
      // Only mobile activation wakes host-renderer slept agents; preserve web/desktop behavior.
      runtime.activateManagedWorktree(params.worktree, {
        notifyClients: params.notifyClients !== false,
        clientKind,
        navigation: resolveRuntimeNavigationTarget({
          navigation: params.navigation,
          notifyClients: params.notifyClients,
          clientKind,
          defaultTarget: 'host'
        })
      })
  }),
  WORKTREE_CREATE_METHOD,
  WORKTREE_PROVISIONED_ROOT_METHOD,
  defineMethod({
    name: 'worktree.prefetchCreateBase',
    permission: 'workspace',
    params: WorktreePrefetchCreateBase,
    handler: async (params, { runtime }) => {
      await runtime.prefetchManagedWorktreeCreateBase({
        repoSelector: params.repo,
        baseBranch: params.baseBranch
      })
      return null
    }
  }),
  WORKTREE_SET_METHOD,
  defineMethod({
    name: 'worktree.persistSortOrder',
    permission: 'workspace',
    params: WorktreeSortOrder,
    handler: async (params, { runtime }) =>
      runtime.persistManagedWorktreeSortOrder(params.orderedIds, params.hostIds)
  }),
  defineMethod({
    name: 'worktree.resolvePrBase',
    permission: 'workspace',
    params: WorktreeResolvePrBase,
    handler: async (params, { runtime }) =>
      runtime.resolveManagedPrBase({
        repoSelector: params.repo,
        prNumber: params.prNumber,
        headRefName: params.headRefName,
        baseRefName: params.baseRefName,
        isCrossRepository: params.isCrossRepository,
        wakeWslDistro: params.wakeWslDistro
      })
  }),
  defineMethod({
    name: 'worktree.resolveMrBase',
    permission: 'workspace',
    params: WorktreeResolveMrBase,
    handler: async (params, { runtime }) =>
      runtime.resolveManagedMrBase({
        repoSelector: params.repo,
        mrIid: params.mrIid,
        sourceBranch: params.sourceBranch,
        targetBranch: params.targetBranch,
        isCrossRepository: params.isCrossRepository,
        wakeWslDistro: params.wakeWslDistro
      })
  }),
  defineMethod({
    name: 'worktree.rm',
    permission: 'workspace',
    params: WorktreeRemove,
    handler: async (params, context) => {
      const { runtime } = context
      if (runtime.ownsRecipeWorkspaceRemoval?.(params)) {
        return runtime.removeRecipeWorkspace(params)
      }
      // Translate a paired client's runtime-local host spelling before host-qualified reads.
      let resolvedHostId = resolvePairedCallerHostId(
        () => runtime.listRepos(),
        params.worktree,
        params.hostId
      )
      // Older mobile omits hostId; resolve ambiguity before pinning removal and refuse ids shared by two hosts.
      if (!resolvedHostId) {
        try {
          resolvedHostId = (await runtime.showManagedWorktree(params.worktree)).hostId
          if (!resolvedHostId) {
            throw new Error('worktree.rm could not resolve the workspace host')
          }
        } catch (error) {
          // Git may omit a stale path: selector_not_found must reach removeManagedWorktree; propagate other resolution failures.
          if (!(error instanceof Error) || error.message !== 'selector_not_found') {
            throw error
          }
        }
      }
      // Parse id: selectors for repo stamping; resolving again scans and rejects ids shared by hosts. Leave other selectors unstamped.
      const explicitWorktreeId = getExplicitWorktreeIdSelector(params.worktree)
      const repoId = explicitWorktreeId ? splitWorktreeId(explicitWorktreeId)?.repoId : undefined
      const result = await queueWorkspaceDelete(
        runtime,
        params.worktree,
        resolvedHostId,
        params,
        (removal) => {
          const options = {
            ...removal,
            waitForBackgroundRemoval: waitsForWorktreeRemoval(context, params)
          }
          return params.approvedNestedWorktrees
            ? runtime.removeManagedWorktreeWithNested(
                params.worktree,
                params.approvedNestedWorktrees,
                options
              )
            : runtime.removeManagedWorktree(params.worktree, options)
        }
      )
      return {
        removed: result.removing !== true,
        ...result,
        ...(repoId ? { catalogVersion: getLocalWorktreeCatalogVersion(repoId) } : {})
      }
    }
  }),
  defineMethod({
    name: 'worktree.previewNestedRemoval',
    permission: 'workspace',
    params: WorktreePreviewNestedRemoval,
    handler: async (params, { runtime }) =>
      runtime.previewNestedManagedWorktreeRemoval(
        params.worktree,
        resolvePairedCallerHostId(() => runtime.listRepos(), params.worktree, params.hostId)
      )
  }),
  defineMethod({
    name: 'worktree.forceDeleteBranch',
    permission: 'workspace',
    params: WorktreeForceDeleteBranch,
    handler: async (params, { runtime }) => {
      const hostId = resolvePairedCallerHostId(
        () => runtime.listRepos(),
        params.worktree,
        params.hostId
      )
      return hostId
        ? runtime.forceDeletePreservedBranch(
            params.worktree,
            params.branchName,
            params.expectedHead,
            hostId
          )
        : runtime.forceDeletePreservedBranch(
            params.worktree,
            params.branchName,
            params.expectedHead
          )
    }
  })
]
