import {
  finishAutomationWorkspaceProvenanceRequest,
  releaseAutomationWorkspaceProvenanceRequest,
  resolveAutomationWorkspaceProvenance,
  resolveClientAutomationWorkspaceProvenance
} from '../../../../automations/ownership/workspace-provenance'
import { getLocalWorktreeCatalogVersion } from '../../../../workspaces/catalog/local-worktree-scan-generation'
import { buildCliWorkspaceProvenance } from '../../../../../shared/worktree/creation/cli-workspace-provenance'
import { createWorktreeWithStartupAgent } from '../../../../agent-launch/startup-agent-worktree-create'
import { defineMethod } from '../../core'
import { buildManagedWorktreeCreateArgs, worktreeCreateRepoSelector } from './worktree-create-args'
import { resolveRpcWorkspaceCreatorProvenance } from '../../callers/workspace-creator-context'
import { WorktreeCreate } from '../../../../../shared/rpc-contract/workspaces/worktree-create-params'
import { assertPersonCreatesAgent } from '../agent-creation-caller-admission'

export const WORKTREE_CREATE_METHOD = defineMethod({
  name: 'worktree.create',
  permission: 'workspace',
  params: WorktreeCreate,
  handler: async (params, context) => {
    if (params.startupAgent) {
      assertPersonCreatesAgent(context, 'worktree.create --agent')
    }
    // Mobile retries after migration share clientMutationId; return the same pending/created worktree. Desktop/CLI without keys run plainly.
    return context.runtime.dedupeWorktreeCreate(params, params.clientMutationId, async () => {
      const { runtime } = context
      const repo = await runtime.showRepo(worktreeCreateRepoSelector(params))
      const automationProvenance =
        resolveAutomationWorkspaceProvenance({
          authority: runtime,
          repoSelector: params.repo,
          repo,
          request: params.automationProvenanceRequest,
          ignoreUnknownAutomation: true
        }) ??
        resolveClientAutomationWorkspaceProvenance({
          authority: runtime,
          provenance: params.clientAutomationProvenance
        })
      // Reserve provenance before create for recovery, but release failed reservations so retry is safe.
      try {
        const result = await createWorktreeWithStartupAgent(
          runtime,
          buildManagedWorktreeCreateArgs(
            params,
            {
              automationProvenance,
              cliProvenance: buildCliWorkspaceProvenance(params.cliProvenanceRequest, {
                startupAgent: params.startupAgent ?? params.createdWithAgent,
                createdAt: Date.now()
              }),
              creatorProvenance: resolveRpcWorkspaceCreatorProvenance(context)
            },
            context
          )
        )
        finishAutomationWorkspaceProvenanceRequest(params.automationProvenanceRequest)
        // Create notification already bumped generation; stamp the catalog containing the new worktree.
        const stamped = { ...result, catalogVersion: getLocalWorktreeCatalogVersion(repo.id) }
        // Agent callers need a stable target without duplicate terminal-list layout entries.
        return params.startupAgent && result.startupTerminal?.handle
          ? { ...stamped, agentTerminalHandle: result.startupTerminal.handle }
          : stamped
      } catch (error) {
        releaseAutomationWorkspaceProvenanceRequest(params.automationProvenanceRequest)
        throw error
      }
    })
  }
})
