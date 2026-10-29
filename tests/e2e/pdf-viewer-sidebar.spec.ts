import { rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { createPdfFindFixture } from './helpers/pdf-find-fixture'

async function openPdf(page: Page, filePath: string): Promise<void> {
  await page.evaluate(
    ({ filePath, relativePath }) => {
      const state = window.__store?.getState()
      if (!state?.activeWorktreeId) {
        throw new Error('Missing fixture worktree')
      }
      state.openFile({
        filePath,
        relativePath,
        worktreeId: state.activeWorktreeId,
        language: 'plaintext',
        mode: 'edit'
      })
    },
    { filePath, relativePath: path.basename(filePath) }
  )
  // Why: a terminal that finishes starting can take the front; bring the PDF tab back.
  await expect
    .poll(() =>
      page.evaluate((filePath) => {
        const state = window.__store?.getState()
        const file = state?.openFiles.find((candidate) => candidate.filePath === filePath)
        if (!state || !file) {
          return false
        }
        if (state.activeFileId !== file.id || state.activeTabType !== 'editor') {
          state.setActiveFile(file.id)
          state.setActiveTabType('editor', state.activeWorktreeId)
          return false
        }
        return true
      }, filePath)
    )
    .toBe(true)
}

async function closePdf(page: Page, filePath: string): Promise<void> {
  await page.evaluate((filePath) => {
    const state = window.__store?.getState()
    const file = state?.openFiles.find((candidate) => candidate.filePath === filePath)
    if (!state || !file) {
      throw new Error('Missing open PDF')
    }
    state.closeFile(file.id)
  }, filePath)
}

test('PDF sidebar navigates by outline and page thumbnails, and remembers itself', async ({
  orcaPage,
  seededRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  const withOutline = path.join(seededRepoPath, 'paper.pdf')
  const plain = path.join(seededRepoPath, 'plain.pdf')
  writeFileSync(
    withOutline,
    createPdfFindFixture({
      title: 'Paper',
      outline: [
        { title: 'Introduction', page: 1 },
        {
          title: 'Method',
          page: 2,
          children: [
            { title: 'Setup', page: 2 },
            { title: 'Model', page: 3 }
          ]
        },
        { title: 'Results', page: 3 }
      ]
    })
  )
  writeFileSync(plain, createPdfFindFixture({ title: 'Plain' }))
  registerPostElectronShutdownCleanup(async () => {
    rmSync(withOutline, { force: true })
    rmSync(plain, { force: true })
  })
  const sidebar = orcaPage.locator('[data-pdf-sidebar]')
  const toggle = orcaPage.getByRole('button', { name: 'Show outline and pages' })
  const pageInput = orcaPage.locator('[data-pdf-page-input]')
  const outline = sidebar.locator('[data-pdf-outline]')
  const item = (title: string) => outline.getByRole('treeitem').filter({ hasText: title })

  await openPdf(orcaPage, withOutline)
  await expect(pageInput).toHaveValue('1')
  await expect(sidebar).toHaveCount(0)
  await toggle.click()

  // A PDF with an outline opens on it: top-level sections with their pages, the first marked.
  await expect(sidebar.getByRole('tab', { name: 'Outline' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  await expect(outline.getByRole('treeitem')).toHaveCount(3)
  await expect(item('Method')).toContainText('2')
  await expect(item('Introduction')).toHaveAttribute('aria-current', 'location')
  await orcaPage.screenshot({ path: testInfo.outputPath('1-outline.png'), animations: 'disabled' })

  // A bookmark jumps there; the section the reader is in unfolds and takes the mark.
  await item('Results').getByRole('button', { name: 'Results' }).click()
  await expect(pageInput).toHaveValue('3')
  await expect(item('Results')).toHaveAttribute('aria-current', 'location')
  await item('Method').getByRole('button', { name: 'Expand' }).click()
  await expect(item('Setup')).toBeVisible()
  // Model and Results share page 3: the one picked keeps the mark, and its fold still folds.
  await item('Model').getByRole('button', { name: 'Model' }).click()
  await expect(pageInput).toHaveValue('3')
  await expect(item('Model')).toHaveAttribute('aria-current', 'location')
  await item('Method').getByRole('button', { name: 'Collapse' }).click()
  await expect(outline.getByRole('treeitem')).toHaveCount(3)
  await expect(item('Method')).toHaveAttribute('aria-expanded', 'false')

  // Page thumbnails mark the current page and jump on click.
  await sidebar.getByRole('tab', { name: 'Pages' }).click()
  await expect(sidebar.getByRole('tab', { name: 'Pages' })).toHaveAttribute('aria-selected', 'true')
  const thumbnails = sidebar.locator('[data-pdf-thumbnail]')
  await expect(thumbnails).toHaveCount(3)
  await expect(sidebar.locator('[data-pdf-thumbnail="3"]')).toHaveAttribute('aria-current', 'page')
  await sidebar.locator('[data-pdf-thumbnail="2"]').click()
  await expect(pageInput).toHaveValue('2')
  await expect(sidebar.locator('[data-pdf-thumbnail="2"]')).toHaveAttribute('aria-current', 'page')
  await expect
    .poll(() =>
      sidebar
        .locator('[data-pdf-thumbnail="1"] canvas')
        .evaluate((canvas: HTMLCanvasElement) => canvas.width)
    )
    .toBeGreaterThan(0)
  await orcaPage.screenshot({ path: testInfo.outputPath('2-pages.png'), animations: 'disabled' })

  // Reopened, the file brings its sidebar back on the tab last used.
  await closePdf(orcaPage, withOutline)
  await expect(sidebar).toHaveCount(0)
  await openPdf(orcaPage, withOutline)
  await expect(sidebar.getByRole('tab', { name: 'Pages' })).toHaveAttribute('aria-selected', 'true')

  // A PDF without an outline opens its sidebar on the pages, and says so on the outline tab.
  await openPdf(orcaPage, plain)
  await expect(pageInput).toHaveValue('1')
  await toggle.click()
  await expect(sidebar.getByRole('tab', { name: 'Pages' })).toHaveAttribute('aria-selected', 'true')
  await sidebar.getByRole('tab', { name: 'Outline' }).click()
  await expect(sidebar.getByText('This PDF has no outline.')).toBeVisible()
  await orcaPage.getByRole('button', { name: 'Hide outline and pages' }).click()
  await expect(sidebar).toHaveCount(0)
})
