import { rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Page, TestInfo } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { createPdfFindFixture } from './helpers/pdf-find-fixture'

const ERROR_TEXT = 'Failed to load PDF preview'
const STALE_TEXT = 'The latest version could not be loaded; showing the last one that did.'

async function settleAndCapture(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  // Past the external-reload debounce, the PDF settle wait, and the pdf.js parse.
  await page.waitForTimeout(1500)
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`) })
}

test('PDF preview keeps the last good build through failed refreshes, then shows the next', async ({
  orcaPage,
  electronApp,
  seededRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  const filePath = path.join(seededRepoPath, 'rebuilt.pdf')
  const finished = createPdfFindFixture()
  const halfWritten = finished.subarray(0, Math.floor(finished.length / 2))
  const pages = orcaPage.locator('.pdfViewer .page')
  const error = orcaPage.getByText(ERROR_TEXT)
  const stale = orcaPage.locator('[data-pdf-stale-notice]')
  writeFileSync(filePath, halfWritten)
  registerPostElectronShutdownCleanup(async () => rmSync(filePath, { force: true }))
  await orcaPage.evaluate((filePath) => {
    const state = window.__store?.getState()
    if (!state?.activeWorktreeId) {
      throw new Error('Missing fixture worktree')
    }
    state.openFile({
      filePath,
      relativePath: 'rebuilt.pdf',
      worktreeId: state.activeWorktreeId,
      language: 'plaintext',
      mode: 'edit'
    })
  }, filePath)
  // Nothing good has loaded yet, so the broken file shows the error.
  await expect(error).toBeVisible()

  writeFileSync(filePath, finished)
  await settleAndCapture(orcaPage, testInfo, '1-finished-after-error')
  await expect(error).toBeHidden()
  await expect(pages).toHaveCount(3)

  // The page box jumps; a failed refresh keeps the reader on that page of the last good build.
  const pageInput = orcaPage.locator('[data-pdf-page-input]')
  await expect(pageInput).toHaveValue('1')
  await expect(orcaPage.getByText('of 3', { exact: true })).toBeVisible()
  await pageInput.fill('3')
  await pageInput.press('Enter')
  await expect(pageInput).toHaveValue('3')
  // pdf.js renders text only for pages near the viewport, so read the page the reader is on.
  const thirdPage = pages.nth(2).locator('.textLayer')

  // A slow rebuild writes half the file, pauses, then finishes: the half file is never parsed.
  writeFileSync(filePath, halfWritten)
  await orcaPage.waitForTimeout(1500)
  await expect(stale).toHaveCount(0)
  await expect(pages).toHaveCount(3)
  writeFileSync(filePath, createPdfFindFixture({ title: 'Slow build' }))
  await expect(thirdPage).toContainText('Slow build - page 3')
  await expect(stale).toHaveCount(0)
  await expect(pageInput).toHaveValue('3')

  // A build that stops half-written is given up on after the settle wait, keeping the last one.
  writeFileSync(filePath, halfWritten)
  await expect(stale).toContainText(STALE_TEXT, { timeout: 15_000 })
  await expect(error).toBeHidden()
  await expect(pages).toHaveCount(3)
  await expect(thirdPage).toContainText('Slow build - page 3')
  await expect(pageInput).toHaveValue('3')
  await settleAndCapture(orcaPage, testInfo, '2-failed-refresh')

  writeFileSync(filePath, '')
  await orcaPage.waitForTimeout(1000)
  await expect(stale).toBeVisible()
  await expect(pages).toHaveCount(3)

  // A distinct finished build, so the swap to the new document is observable.
  writeFileSync(filePath, createPdfFindFixture({ title: 'Next build' }))
  await expect(thirdPage).toContainText('Next build - page 3')
  await expect(stale).toHaveCount(0)
  await expect(error).toBeHidden()
  // The swap keeps the reader on the page they jumped to.
  await expect(pageInput).toHaveValue('3')
  await orcaPage.screenshot({ path: testInfo.outputPath('3-next-build.png') })

  // Closed and opened again, the file comes back on that page.
  await orcaPage.evaluate((filePath) => {
    const state = window.__store?.getState()
    const file = state?.openFiles.find((candidate) => candidate.filePath === filePath)
    if (!state || !file) {
      throw new Error('Missing open PDF')
    }
    state.closeFile(file.id)
  }, filePath)
  await expect(orcaPage.locator('.pdfViewer')).toHaveCount(0)
  await orcaPage.evaluate((filePath) => {
    const state = window.__store?.getState()
    if (!state?.activeWorktreeId) {
      throw new Error('Missing fixture worktree')
    }
    state.openFile({
      filePath,
      relativePath: 'rebuilt.pdf',
      worktreeId: state.activeWorktreeId,
      language: 'plaintext',
      mode: 'edit'
    })
  }, filePath)
  await expect(pageInput).toHaveValue('3')
  const windows = await electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((window) => ({
      visible: window.isVisible(),
      focused: window.isFocused()
    }))
  )
  expect(windows.every((window) => !window.visible && !window.focused)).toBe(true)
})
