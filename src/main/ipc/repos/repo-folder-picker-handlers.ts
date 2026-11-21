import type { OpenDialogOptions } from 'electron'
import { BrowserWindow, ipcMain } from 'electron'
import { dirname } from 'node:path'
import type { Store } from '../../persistence/loading-store/store'
import type { Repo } from '../../../shared/repository/repo-types'
import {
  getRepoExecutionHostId,
  LOCAL_EXECUTION_HOST_ID
} from '../../../shared/execution-host/execution-host'
import { withoutWslMovedRepos } from '../../persistence/moving-wsl-projects/quiescence/wsl-move-scope-guard'
import { showSingleFlightOpenDialog } from '../dialogs/single-flight-open-dialog'

// Why: the OS's last-used folder is shared with attachment and save dialogs, so start beside the newest local project.
function newestLocalProjectParent(store: Pick<Store, 'getRepos'>): string | undefined {
  let newest: Repo | undefined
  for (const repo of withoutWslMovedRepos(store.getRepos())) {
    if (
      getRepoExecutionHostId(repo) === LOCAL_EXECUTION_HOST_ID &&
      (!newest || repo.addedAt > newest.addedAt)
    ) {
      newest = repo
    }
  }
  return newest ? dirname(newest.path) : undefined
}

export function registerRepoFolderPickerHandlers(
  mainWindow: BrowserWindow,
  store: Pick<Store, 'getRepos'>
): void {
  const projectPickerOptions = (
    properties: OpenDialogOptions['properties']
  ): OpenDialogOptions => ({ defaultPath: newestLocalProjectParent(store), properties })

  ipcMain.handle('repos:pickFolder', async (event) => {
    const result = await showSingleFlightOpenDialog(
      projectPickerOptions(['openDirectory']),
      // The dialog belongs to the native window that asked.
      BrowserWindow.fromWebContents(event.sender) ?? mainWindow
    )
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths[0]
  })

  ipcMain.handle('repos:pickFolders', async (event) => {
    const result = await showSingleFlightOpenDialog(
      projectPickerOptions(['openDirectory', 'multiSelections']),
      BrowserWindow.fromWebContents(event.sender) ?? mainWindow
    )
    if (result.canceled || result.filePaths.length === 0) {
      return []
    }
    return result.filePaths
  })

  // Clone destinations need a generic picker because they may not contain a Git repo.
  ipcMain.handle('repos:pickDirectory', async (event) => {
    const result = await showSingleFlightOpenDialog(
      // macOS creates typed partial paths when directory creation is enabled; defer creation to submit.
      projectPickerOptions(['openDirectory']),
      BrowserWindow.fromWebContents(event.sender) ?? mainWindow
    )
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths[0]
  })
}
