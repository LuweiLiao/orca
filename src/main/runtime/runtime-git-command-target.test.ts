import { afterEach, describe, expect, it, vi } from 'vitest'

const { getStatus } = vi.hoisted(() => ({ getStatus: vi.fn() }))
vi.mock('../git/status', () => ({ getStatus }))

import { ExecutionHostNotDispatchableError } from '../providers/execution-host-provider-dispatch'
import { createLocalGitProvider } from '../providers/local-git-provider'
import { SshHostNotServedError } from '../providers/ssh-host-not-served-error'
import {
  localGitOptionsForTarget,
  requireRuntimeGitProvider,
  runtimeGitRouteForTarget,
  resolveRuntimeGitReadTarget,
  type RuntimeGitTarget
} from './runtime-git-command-target'

const worktree = {
  id: 'wt-1',
  repoId: 'repo-1',
  path: '/srv/app',
  git: { path: '/srv/app', branch: 'main', isBare: false, isMainWorktree: false }
} as unknown as RuntimeGitTarget['worktree']

function target(overrides: Partial<RuntimeGitTarget>): RuntimeGitTarget {
  return { worktree, executionHostId: 'local', ...overrides }
}

describe('runtime Git target routing', () => {
  afterEach(() => {
    getStatus.mockReset()
  })

  it('resolves folder reads with their file owner and refuses remote-to-local fallback', async () => {
    const folderTarget = target({ executionHostId: 'ssh:folder-owner' })
    const host = {
      resolveRuntimeGitTarget: vi.fn(async () => target({})),
      resolveRuntimeFileTarget: vi.fn(async () => folderTarget),
      getRuntimeSettings: () => ({})
    }
    const resolved = await resolveRuntimeGitReadTarget(host, 'id:folder:notes')
    expect(host.resolveRuntimeFileTarget).toHaveBeenCalledWith('id:folder:notes')
    expect(host.resolveRuntimeGitTarget).not.toHaveBeenCalled()
    expect(() => requireRuntimeGitProvider(resolved)).toThrow(SshHostNotServedError)
    host.resolveRuntimeFileTarget.mockRejectedValueOnce(new Error('selector_not_found'))
    await expect(resolveRuntimeGitReadTarget(host, 'id:folder:removed')).rejects.toThrow(
      'selector_not_found'
    )
    expect(host.resolveRuntimeGitTarget).not.toHaveBeenCalled()
    const ordinary = await resolveRuntimeGitReadTarget(host, 'id:repo::/srv/app')
    expect(ordinary.executionHostId).toBe('local')
    expect(host.resolveRuntimeGitTarget).toHaveBeenCalledWith('id:repo::/srv/app')
  })

  it('answers `local` with a provider bound to this worktree, built per call', async () => {
    expect(runtimeGitRouteForTarget(target({}))).toEqual({
      kind: 'local',
      createProvider: createLocalGitProvider
    })
    const localTarget = target({ localGitOptions: { wslDistro: 'Ubuntu' } })
    expect(requireRuntimeGitProvider(localTarget)).not.toBe(requireRuntimeGitProvider(localTarget))

    await requireRuntimeGitProvider(localTarget).getStatus('/srv/app')
    expect(getStatus).toHaveBeenCalledWith('/srv/app', {
      wslDistro: 'Ubuntu',
      admissionTier: 'status'
    })
  })

  // Loss of contact is never evidence of locality (docs/reference/ssh-execution-boundary.md).
  it('keeps an ssh host remote instead of degrading it to local', () => {
    const route = runtimeGitRouteForTarget(target({ executionHostId: 'ssh:gone' }))

    expect(route).toEqual({ kind: 'ssh', connectionId: 'gone' })
    expect(() => requireRuntimeGitProvider(target({ executionHostId: 'ssh:gone' }))).toThrow(
      SshHostNotServedError
    )
    expect(getStatus).not.toHaveBeenCalled()
  })

  it('refuses a runtime host instead of routing it', () => {
    expect(() => runtimeGitRouteForTarget(target({ executionHostId: 'runtime:env-a' }))).toThrow(
      ExecutionHostNotDispatchableError
    )
    expect(() => requireRuntimeGitProvider(target({ executionHostId: 'runtime:env-a' }))).toThrow(
      ExecutionHostNotDispatchableError
    )
  })

  it('keeps WSL routing on the local host and off every other one', () => {
    const localGitOptions = { wslDistro: 'Ubuntu' }

    expect(localGitOptionsForTarget(target({ localGitOptions }))).toEqual(localGitOptions)
    expect(
      localGitOptionsForTarget(target({ executionHostId: 'ssh:m4air', localGitOptions }))
    ).toEqual({})
    expect(
      localGitOptionsForTarget(target({ executionHostId: 'runtime:env-a', localGitOptions }))
    ).toEqual({})
  })
})
