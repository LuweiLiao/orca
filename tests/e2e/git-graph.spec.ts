import { runProcessSync } from '@orca/process-host'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { folderWorkspaceKey } from '../../src/shared/workspace-scope'
import { test, expect } from './helpers/orca-app'
import { openSourceControlForWorktree } from './helpers/worktree-registration'

function git(cwd: string, args: string[]): string {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_'))
  )
  const result = runProcessSync({
    program: 'git',
    args: ['-c', 'commit.gpgsign=false', ...args],
    cwd,
    env,
    timeoutMs: 10_000
  })
  if (result.code !== 0 || result.timedOut || result.outputTruncated) {
    throw new Error(`Git fixture failed: ${result.stderr}`)
  }
  return result.stdout.trim()
}

test('browses a pinned multi-branch history and opens a real commit diff', async ({
  orcaPage,
  electronApp,
  testRepoPath
}, testInfo) => {
  const base = git(testRepoPath, ['rev-parse', 'HEAD'])
  const tree = git(testRepoPath, ['rev-parse', 'HEAD^{tree}'])
  const side = git(testRepoPath, ['commit-tree', tree, '-p', base, '-m', 'Unmerged graph branch'])
  git(testRepoPath, ['update-ref', 'refs/heads/graph-side', side])
  // Why a second independent branch: HEAD's own tip is always walked (scopeTips), so proving the
  // multi-select filter actually narrows the walk needs two branches that are both off-HEAD.
  const otherSide = git(testRepoPath, [
    'commit-tree',
    tree,
    '-p',
    base,
    '-m',
    'Another unmerged branch'
  ])
  git(testRepoPath, ['update-ref', 'refs/heads/graph-other', otherSide])
  let tip = base
  for (let index = 0; index < 124; index++) {
    tip = git(testRepoPath, ['commit-tree', tree, '-p', tip, '-m', `Graph history ${index}`])
  }
  git(testRepoPath, ['update-ref', 'HEAD', tip])
  writeFileSync(path.join(testRepoPath, 'graph-proof.txt'), 'Git Graph diff evidence\n')
  git(testRepoPath, ['add', 'graph-proof.txt'])
  git(testRepoPath, [
    'commit',
    '-m',
    'Git Graph end-to-end commit',
    '-m',
    'Commit body survives the graph query.'
  ])
  const initialHead = git(testRepoPath, ['rev-parse', 'HEAD'])

  const first = await orcaPage.evaluate(
    async (worktreePath) => window.api.git.historyGraph({ worktreePath, scope: 'all', limit: 5 }),
    testRepoPath
  )
  expect(first.items).toHaveLength(5)
  expect(first.hasMore).toBe(true)
  expect(first.refs.some((ref) => ref.id === 'refs/heads/graph-side')).toBe(true)
  expect(first.headOid).toBe(initialHead)

  git(testRepoPath, ['commit', '--allow-empty', '-m', 'Commit after graph snapshot'])
  const pagedIds = first.items.map((item) => item.id)
  let cursor = first.nextCursor
  let pageCount = 1
  while (cursor) {
    expect(pageCount++).toBeLessThan(40)
    const page = await orcaPage.evaluate(
      async ({ worktreePath, cursor }) =>
        window.api.git.historyGraph({ worktreePath, scope: 'all', limit: 5, cursor }),
      { worktreePath: testRepoPath, cursor }
    )
    pagedIds.push(...page.items.map((item) => item.id))
    cursor = page.nextCursor
  }
  expect(new Set(pagedIds).size).toBe(pagedIds.length)
  expect(pagedIds).toContain(side)
  expect(pagedIds).toContain(base)
  expect(pagedIds).not.toContain(git(testRepoPath, ['rev-parse', 'HEAD']))

  await orcaPage.setViewportSize({ width: 1440, height: 900 })
  await openSourceControlForWorktree(orcaPage, testRepoPath, testRepoPath)
  await expect(orcaPage.getByRole('button', { name: 'Open Git Graph', exact: true })).toHaveCount(0)
  await orcaPage.getByRole('button', { name: 'Git Graph', exact: true }).click()
  const graph = orcaPage.getByTestId('git-graph-panel')
  await expect(graph).toBeVisible()
  await orcaPage.getByRole('button', { name: 'Git Graph', exact: true }).click()
  expect(
    await orcaPage.evaluate(() => {
      const state = window.__store?.getState()
      return state?.openFiles.filter(
        (file) => file.mode === 'git-graph' && file.worktreeId === state.activeWorktreeId
      ).length
    })
  ).toBe(1)
  expect(await orcaPage.evaluate(() => window.__store?.getState().rightSidebarTab)).toBe(
    'source-control'
  )
  const commits = graph.getByRole('listbox')
  await expect(commits.getByRole('option').first()).toBeVisible()
  await commits.press('End')
  await expect
    .poll(async () =>
      Number(await commits.getByRole('option').first().getAttribute('aria-setsize'))
    )
    .toBeGreaterThan(100)
  await commits.press('End')
  await expect(commits.getByText('Initial commit for E2E tests', { exact: true })).toBeVisible()
  await commits.press('Home')
  await graph
    .getByRole('searchbox', { name: 'Search loaded commits' })
    .fill('Unmerged graph branch')
  await graph.getByRole('button', { name: 'Next match', exact: true }).click()
  await expect(commits.getByRole('option', { selected: true })).toContainText(
    'Unmerged graph branch'
  )
  await graph.getByRole('searchbox', { name: 'Search loaded commits' }).fill('')

  const searchBox = graph.getByRole('searchbox', { name: 'Search loaded commits' })
  // Why search instead of scanning the DOM: `side`/`otherSide` branch off near `base`, deep
  // past the first page, so scrolling to the end (which auto-loads more, see
  // LOAD_MORE_THRESHOLD_ROWS) until aria-setsize stops growing, then searching the loaded
  // commits, is the reliable way to find them.
  async function currentSetSize(): Promise<number> {
    return Number(await commits.getByRole('option').first().getAttribute('aria-setsize'))
  }
  async function loadAllAndFind(text: string): Promise<boolean> {
    let setSize = await currentSetSize()
    for (let guard = 0; guard < 60; guard += 1) {
      await commits.press('End')
      // Why poll-then-settle: End only starts an async page fetch; a size bump within the
      // window means more pages may follow, so loop again instead of stopping early.
      const grew = await expect
        .poll(currentSetSize, { timeout: 1500 })
        .toBeGreaterThan(setSize)
        .then(() => true)
        .catch(() => false)
      if (!grew) {
        break
      }
      setSize = await currentSetSize()
    }
    await commits.press('Home')
    await searchBox.fill(text)
    const noMatches = graph.getByText('No matches', { exact: true })
    const found = await noMatches
      .waitFor({ state: 'visible', timeout: 1000 })
      .then(() => false)
      .catch(() => true)
    await searchBox.fill('')
    return found
  }

  const branchFilterTrigger = graph.getByRole('combobox', { name: 'Branch filter' })
  const branchFilterPopover = orcaPage.locator('[data-slot="popover-content"]').last()

  // Why only graph-side first: proves a single selection narrows the walk (graph-other's commit
  // is excluded) before the two-branch selection proves the union (both become visible).
  await branchFilterTrigger.click()
  await expect(branchFilterPopover).toBeVisible()
  await orcaPage.screenshot({ path: testInfo.outputPath('git-graph-branch-filter-popover.png') })
  await branchFilterPopover.getByRole('option', { name: 'graph-side', exact: true }).click()
  await orcaPage.keyboard.press('Escape')
  await expect(branchFilterTrigger).toHaveText('graph-side')
  expect(await loadAllAndFind('Unmerged graph branch')).toBe(true)
  expect(await loadAllAndFind('Another unmerged branch')).toBe(false)

  await branchFilterTrigger.click()
  await branchFilterPopover.getByRole('option', { name: 'graph-other', exact: true }).click()
  await orcaPage.keyboard.press('Escape')
  await expect(branchFilterTrigger).toHaveText('graph-side, graph-other')
  expect(await loadAllAndFind('Unmerged graph branch')).toBe(true)
  expect(await loadAllAndFind('Another unmerged branch')).toBe(true)

  await branchFilterTrigger.click()
  await branchFilterPopover.getByRole('option', { name: 'graph-side', exact: true }).click()
  await branchFilterPopover.getByRole('option', { name: 'graph-other', exact: true }).click()
  await orcaPage.keyboard.press('Escape')
  await expect(branchFilterTrigger).toHaveText('All branches')
  await commits.press('Home')
  await expect(commits.getByRole('option').first()).toContainText('Commit after graph snapshot')
  await graph.getByText('Git Graph end-to-end commit', { exact: true }).first().click()
  await expect(
    graph.getByText('Commit body survives the graph query.', { exact: false })
  ).toBeVisible()
  await expect(graph.getByText('graph-proof.txt', { exact: true })).toBeVisible()
  await expect(graph.locator('svg circle').first()).toBeVisible()
  await orcaPage.evaluate(async () => {
    await window.__store?.getState().updateSettingsOrThrow({ theme: 'dark' })
  })
  await expect(orcaPage.locator('html')).toHaveClass(/dark/)
  await orcaPage.screenshot({ path: testInfo.outputPath('git-graph-desktop.png') })

  await orcaPage.setViewportSize({ width: 900, height: 760 })
  await expect(graph.getByText('graph-proof.txt', { exact: true })).toBeVisible()
  await orcaPage.screenshot({ path: testInfo.outputPath('git-graph-narrow.png') })
  await orcaPage.setViewportSize({ width: 1440, height: 900 })
  await orcaPage.evaluate(async () => {
    await window.__store?.getState().updateSettingsOrThrow({ theme: 'light' })
  })
  await expect(orcaPage.locator('html')).not.toHaveClass(/dark/)
  await orcaPage.screenshot({ path: testInfo.outputPath('git-graph-light.png') })

  await graph.getByText('graph-proof.txt', { exact: true }).click()
  await expect(
    orcaPage.getByText('Git Graph diff evidence', { exact: false }).first()
  ).toBeVisible()
  await expect(graph).not.toBeVisible()
  await orcaPage.getByRole('button', { name: 'Git Graph', exact: true }).click()
  await expect(graph.getByRole('listbox').getByRole('option').first()).toBeVisible()
  await orcaPage.evaluate(() => window.__store?.getState().setActivityBarPosition('side'))
  await orcaPage.getByRole('button', { name: 'Git Graph', exact: true }).click()
  await expect(graph).toBeVisible()
  expect(await orcaPage.evaluate(() => window.__store?.getState().rightSidebarTab)).toBe(
    'source-control'
  )
  expect(
    await orcaPage.evaluate(() => {
      const state = window.__store?.getState()
      return state?.openFiles.filter(
        (file) => file.mode === 'git-graph' && file.worktreeId === state.activeWorktreeId
      ).length
    })
  ).toBe(1)
  await orcaPage.screenshot({ path: testInfo.outputPath('git-graph-side-activity.png') })
  const visibility = await electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((window) => window.isVisible())
  )
  expect(visibility.every((visible) => !visible)).toBe(true)
})

test('shows Git history and a non-Git error in folder workspaces', async ({
  orcaPage,
  registerPostElectronShutdownCleanup
}) => {
  const gitFolder = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'orca-graph-git-folder-')))
  const plainFolder = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'orca-graph-folder-')))
  registerPostElectronShutdownCleanup(async () => {
    rmSync(gitFolder, { recursive: true, force: true })
    rmSync(plainFolder, { recursive: true, force: true })
  })
  git(gitFolder, ['init'])
  git(gitFolder, ['config', 'user.name', 'Git Graph E2E'])
  git(gitFolder, ['config', 'user.email', 'git-graph@example.test'])
  writeFileSync(path.join(gitFolder, 'folder-proof.txt'), 'Folder Git diff evidence\n')
  git(gitFolder, ['add', 'folder-proof.txt'])
  git(gitFolder, ['commit', '-m', 'Standalone folder history'])
  for (const folderPath of [gitFolder, plainFolder]) {
    const folderId = await orcaPage.evaluate(async (folderPath) => {
      const store = window.__store
      if (!store) {
        throw new Error('Renderer store unavailable')
      }
      const group = await store.getState().createProjectGroup('Graph folders', 'local')
      if (!group) {
        throw new Error('Folder group creation failed')
      }
      const folder = await store
        .getState()
        .createFolderWorkspace(
          { projectGroupId: group.id, name: 'Graph folder', folderPath },
          { runtimeEnvironmentId: null }
        )
      if (!folder) {
        throw new Error('Folder workspace creation failed')
      }
      return folder.id
    }, folderPath)
    await orcaPage.evaluate((worktreeId) => {
      const store = window.__store
      if (!store) {
        throw new Error('Renderer store unavailable')
      }
      store.getState().setActiveWorktree(worktreeId)
    }, folderWorkspaceKey(folderId))
    await orcaPage.getByRole('button', { name: 'Git Graph', exact: true }).click()
    const graph = orcaPage.locator('[data-testid="git-graph-panel"]:visible')
    await expect(graph).toBeVisible()
    if (folderPath === gitFolder) {
      await expect(
        graph.getByText('Standalone folder history', { exact: true }).first()
      ).toBeVisible()
      await expect(graph.locator('svg circle').first()).toBeVisible()
      await graph.getByText('Standalone folder history', { exact: true }).first().click()
      await graph.getByText('folder-proof.txt', { exact: true }).click()
      await expect(
        orcaPage.getByText('Folder Git diff evidence', { exact: false }).first()
      ).toBeVisible()
    } else {
      await expect(graph.getByRole('status')).toContainText('not a Git repository')
    }
  }
})
