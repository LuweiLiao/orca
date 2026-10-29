import { rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { createPdfFindFixture, createPdfSynctexFixture } from './helpers/pdf-find-fixture'

const TEX = [
  '\\documentclass{article}',
  '\\begin{document}',
  'Paper - page 1',
  'needle result 1',
  'needle result 2',
  '\\newpage',
  'Paper - page 2',
  'needle result 3',
  'needle result 4',
  '\\end{document}'
].join('\n')

async function showFile(page: Page, filePath: string): Promise<void> {
  // Why: a terminal that finishes starting can take the front; bring the file's tab back.
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

function cursorLine(page: Page, filePath: string): Promise<number | null> {
  return page.evaluate((filePath) => {
    const state = window.__store?.getState()
    const file = state?.openFiles.find((candidate) => candidate.filePath === filePath)
    return file ? (state?.editorCursorLine[file.id] ?? null) : null
  }, filePath)
}

test('SyncTeX jumps from a PDF spot to its source line and back', async ({
  orcaPage,
  seededRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  const texPath = path.join(seededRepoPath, 'paper.tex')
  const pdfPath = path.join(seededRepoPath, 'paper.pdf')
  const synctexPath = path.join(seededRepoPath, 'paper.synctex.gz')
  writeFileSync(texPath, TEX)
  writeFileSync(pdfPath, createPdfFindFixture({ title: 'Paper' }))
  writeFileSync(
    synctexPath,
    createPdfSynctexFixture(texPath, [
      { page: 1, textLine: 0, sourceLine: 3 },
      { page: 1, textLine: 1, sourceLine: 4 },
      { page: 1, textLine: 2, sourceLine: 5 },
      { page: 2, textLine: 0, sourceLine: 7 },
      { page: 2, textLine: 1, sourceLine: 8 },
      { page: 2, textLine: 2, sourceLine: 9 }
    ])
  )
  registerPostElectronShutdownCleanup(async () => {
    for (const file of [texPath, pdfPath, synctexPath]) {
      rmSync(file, { force: true })
    }
  })
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

  await orcaPage.evaluate((pdfPath) => {
    const state = window.__store?.getState()
    if (!state?.activeWorktreeId) {
      throw new Error('Missing fixture worktree')
    }
    state.openFile({
      filePath: pdfPath,
      relativePath: 'paper.pdf',
      worktreeId: state.activeWorktreeId,
      language: 'plaintext',
      mode: 'edit'
    })
  }, pdfPath)
  await showFile(orcaPage, pdfPath)
  const firstPage = orcaPage.locator('.pdfViewer .page[data-page-number="1"] .textLayer')
  await expect(firstPage).toContainText('needle result 2')

  // PDF → source: Ctrl/Cmd-click a line opens the .tex on the line that produced it.
  await firstPage.getByText('needle result 2').click({ modifiers: [modifier] })
  await expect.poll(() => cursorLine(orcaPage, texPath)).toBe(5)
  await expect(orcaPage.locator('.monaco-editor .view-line').first()).toBeVisible()
  await orcaPage.screenshot({ path: testInfo.outputPath('1-source.png'), animations: 'disabled' })

  // Source → PDF: "Show in PDF" from line 8 brings the PDF to page 2 and marks the line.
  await orcaPage.locator('.monaco-editor .view-line').filter({ hasText: 'needle result 3' }).click()
  await expect.poll(() => cursorLine(orcaPage, texPath)).toBe(8)
  await orcaPage.keyboard.press(`${modifier}+Alt+KeyJ`)
  const pageInput = orcaPage.locator('[data-pdf-page-input]')
  await expect(pageInput).toHaveValue('2')
  const mark = orcaPage.locator('.pdfViewer .page[data-page-number="2"] [data-pdf-synctex-mark]')
  await expect(mark).toHaveCount(1, { timeout: 5000 })
  // The mark covers the line the source produced, not the page top; read both before it fades.
  const overlap = await orcaPage.evaluate(() => {
    const page = document.querySelector('.pdfViewer .page[data-page-number="2"]')
    const mark = page?.querySelector('[data-pdf-synctex-mark]')?.getBoundingClientRect()
    const line = [...(page?.querySelectorAll('.textLayer span') ?? [])]
      .find((span) => span.textContent?.includes('needle result 3'))
      ?.getBoundingClientRect()
    if (!mark || !line) {
      return `mark ${Boolean(mark)} line ${Boolean(line)}`
    }
    const center = mark.top + mark.height / 2
    return center > line.top && center < line.bottom
      ? 'on the line'
      : `mark ${mark.top}-${mark.bottom} line ${line.top}-${line.bottom}`
  })
  expect(overlap).toBe('on the line')
  await orcaPage.screenshot({ path: testInfo.outputPath('2-pdf.png'), animations: 'disabled' })
})
