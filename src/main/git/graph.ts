import { loadGitGraphFromExecutor } from '../../shared/git-graph'
import { GitGraphSnapshotStore } from '../../shared/git-graph-snapshot-store'
import type { GitGraphOptions, GitGraphResult } from '../../shared/git-graph-types'
import type { GitRuntimeOptions } from './git-runtime-options'
import { gitOptionsForWorktree } from './git-runtime-options'
import { gitExecFileAsync } from './runner'

// Why process-wide: desktop IPC and runtime RPC both page through this host's snapshots.
const gitGraphSnapshots = new GitGraphSnapshotStore()

export async function getGitGraph(
  worktreePath: string,
  options: GitGraphOptions & GitRuntimeOptions = {}
): Promise<GitGraphResult> {
  const { wslDistro, signal, admissionTier, ...graphOptions } = options
  const runtimeOptions: GitRuntimeOptions = {
    ...(wslDistro ? { wslDistro } : {}),
    ...(signal ? { signal } : {}),
    ...(admissionTier ? { admissionTier } : {})
  }
  return loadGitGraphFromExecutor(
    (args, cwd, input) =>
      gitExecFileAsync(args, {
        ...gitOptionsForWorktree(cwd, runtimeOptions),
        ...(input?.stdin === undefined ? {} : { stdin: input.stdin })
      }),
    worktreePath,
    graphOptions,
    {
      repositoryKey: JSON.stringify([wslDistro ?? null, worktreePath]),
      snapshots: gitGraphSnapshots
    }
  )
}
