import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import {
  partialRuntimeStore,
  storeFolderWorkspace,
  storeProjectGroup
} from '../runtime/runtime-store-partial-fixture'
import { resolveRegisteredWorkspaceReadPath } from './registered-workspace-read-path'

let folderPath: string

beforeEach(async () => {
  folderPath = await realpath(await mkdtemp(join(tmpdir(), 'orca-graph-auth-')))
})

afterEach(async () => {
  await rm(folderPath, { recursive: true, force: true })
})

function folderStore(connectionId?: string) {
  return partialRuntimeStore({
    getProjects: () => [],
    getProjectGroups: () => [storeProjectGroup({ id: 'group', connectionId })],
    getFolderWorkspaces: () => [
      storeFolderWorkspace({ id: 'folder', projectGroupId: 'group', folderPath })
    ]
  })
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
    resolveRegisteredWorkspaceReadPath(folderPath, partialRuntimeStore())
  ).rejects.toThrow('Access denied')
})
