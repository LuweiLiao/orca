import {
  finishAutomationWorkspaceProvenanceRequest,
  releaseAutomationWorkspaceProvenanceRequest,
  resolveAutomationWorkspaceProvenance
} from '../../../automations/workspace-provenance'
import { getLocalWorktreeCatalogVersion } from '../../../local-worktree-scan-generation'
import { buildCliWorkspaceProvenance } from '../../../../shared/cli-workspace-provenance'
import { createWorktreeWithStartupAgent } from '../../../agent-launch/startup-agent-worktree-create'
import { WorktreeCreate } from '../../../../shared/rpc-contract/worktree-create-params'
import { defineMethod } from '../core'
import { resolveRpcWorkspaceCreatorProvenance } from '../workspace-creator-context'
import { assertPersonCreatesAgent } from './agent-creation-caller-admission'
import { buildManagedWorktreeCreateArgs, worktreeCreateRepoSelector } from './worktree-create-args'

export const WORKTREE_CREATE_METHOD = defineMethod({
  name: 'worktree.create',
  permission: 'workspace',
  params: WorktreeCreate,
  handler: async (params, context) => {
    if (params.startupAgent) {
      assertPersonCreatesAgent(context, 'worktree.create --agent')
    }
    // Why: a mobile create interrupted by a connection migration is retried with
    // the same clientMutationId; dedupe so the host returns the in-flight/created
    // worktree instead of spawning a duplicate. No key (desktop/CLI) runs plainly.
    return context.runtime.dedupeWorktreeCreate(params, params.clientMutationId, async () => {
      const { runtime } = context
      const repo = await runtime.showRepo(worktreeCreateRepoSelector(params))
      const automationProvenance = resolveAutomationWorkspaceProvenance({
        authority: runtime,
        repoSelector: params.repo,
        repo,
        request: params.automationProvenanceRequest
      })
      // Why: provenance tokens are reserved before creation so retries can recover,
      // but failed create attempts must release the reservation for a safe retry.
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
        // Why stamped here: the create's change notification has bumped the generation, so this
        // names the catalog that contains the new worktree.
        const stamped = { ...result, catalogVersion: getLocalWorktreeCatalogVersion(repo.id) }
        // Why: agent callers need a stable dispatch target without traversing
        // terminal-list layout duplicates after creating the worktree.
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
