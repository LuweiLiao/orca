import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { RuntimeStore } from '../runtime/runtime-store-contract'
import { resolveRegisteredWorkspaceReadPath } from './registered-workspace-read-path'

let folderPath: string

beforeEach(async () => {
  folderPath = await realpath(await mkdtemp(join(tmpdir(), 'orca-graph-auth-')))
})

afterEach(async () => {
  await rm(folderPath, { recursive: true, force: true })
})

function folderStore(connectionId?: string, registered = true): RuntimeStore {
  const unexpectedWrite = () => {
    throw new Error('Unexpected store write')
  }
  return {
    getRepos: () => [],
    getRepo: () => undefined,
    getAllWorktreeMeta: () => ({}),
    getWorktreeMeta: () => undefined,
    getGitHubCache: () => ({ pr: {}, issue: {} }),
    addRepo: unexpectedWrite,
    updateRepo: unexpectedWrite,
    setWorktreeMeta: unexpectedWrite,
    removeWorktreeMeta: unexpectedWrite,
    getSettings: () => ({
      workspaceDir: '',
      nestWorkspaces: false,
      refreshLocalBaseRefOnWorktreeCreate: false,
      branchPrefix: 'none',
      branchPrefixCustom: ''
    }),
    getProjects: () => [],
    getProjectGroups: () => [
      {
        id: 'group',
        connectionId,
        name: 'Group',
        parentPath: null,
        parentGroupId: null,
        createdFrom: 'manual',
        tabOrder: 0,
        isCollapsed: false,
        color: null,
        createdAt: 0,
        updatedAt: 0
      }
    ],
    getFolderWorkspaces: () =>
      registered
        ? [
            {
              id: 'folder',
              projectGroupId: 'group',
              folderPath,
              name: 'Folder',
              linkedTask: null,
              comment: '',
              isArchived: false,
              isUnread: false,
              isPinned: false,
              sortOrder: 0,
              lastActivityAt: 0,
              createdAt: 0,
              updatedAt: 0
            }
          ]
        : []
  }
}

it('allows an explicitly registered local folder without registering a Git repo', async () => {
  await expect(resolveRegisteredWorkspaceReadPath(folderPath, folderStore())).resolves.toBe(
    folderPath
  )
})

it('rejects unregistered descendants even within an authorized folder', async () => {
  const child = join(folderPath, 'nested')
  await mkdir(child)
  await expect(resolveRegisteredWorkspaceReadPath(child, folderStore())).rejects.toThrow(
    'Access denied'
  )
})

it('does not read a remote folder from a same-named local path', async () => {
  await expect(
    resolveRegisteredWorkspaceReadPath(folderPath, folderStore('remote'))
  ).rejects.toThrow()
})

it('revokes access when the folder registration is removed', async () => {
  await expect(resolveRegisteredWorkspaceReadPath(folderPath, folderStore())).resolves.toBe(
    folderPath
  )
  await expect(
    resolveRegisteredWorkspaceReadPath(folderPath, folderStore(undefined, false))
  ).rejects.toThrow('Access denied')
})
