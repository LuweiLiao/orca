import { writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from '../../desktop/electron-fixtures/orca-app'
import { expect } from '@stablyai/playwright-test'
import { createPdfFindFixture } from './pdf-find-fixture'

test.describe('PDF region notes', () => {
  test.use({ seedTestRepo: false })

  test('marks a region of a page and saves a note with its text', async ({
    orcaPage,
    registerPostElectronShutdownCleanup
  }, testInfo) => {
    await orcaPage.setViewportSize({ width: 1280, height: 900 })
    const folderPath = mkdtempSync(path.join(os.tmpdir(), 'orca-pdf-notes-'))
    const filePath = path.join(folderPath, 'paper.pdf')
    writeFileSync(filePath, createPdfFindFixture())
    registerPostElectronShutdownCleanup(async () =>
      rmSync(folderPath, { recursive: true, force: true })
    )
    const worktreeId = await orcaPage.evaluate(
      async ({ folderPath, filePath }) => {
        const state = window.__store?.getState()
        if (!state) {
          throw new Error('Missing fixture store')
        }
        // Button names below are the English copy, whatever the machine's language.
        await state.updateSettingsOrThrow({ uiLanguage: 'en' })
        const group = await window.api.projectGroups.create({
          name: 'PDF notes fixture',
          parentPath: folderPath,
          createdFrom: 'folder-scan'
        })
        await state.fetchProjectGroups({ runtimeEnvironmentId: null, throwOnError: true })
        const folder = await state.createFolderWorkspace(
          { projectGroupId: group.id, name: 'PDF notes', folderPath },
          { runtimeEnvironmentId: null }
        )
        if (!folder) {
          throw new Error('Missing fixture folder')
        }
        const id = `folder:${folder.folderWorkspace.id}`
        state.setActiveWorktree(id)
        state.openFile({
          filePath,
          relativePath: 'paper.pdf',
          worktreeId: id,
          language: 'plaintext',
          mode: 'edit'
        })
        return id
      },
      { folderPath, filePath }
    )
    const firstPage = orcaPage.locator('.pdfViewer .page').first()
    const target = firstPage.locator('.textLayer span', { hasText: 'needle result 1' })
    await expect(target).toBeVisible()

    await orcaPage.getByRole('button', { name: 'Mark a region to note' }).click()
    await expect(orcaPage.locator('[data-pdf-annotate-hint]')).toBeVisible()
    const box = await target.boundingBox()
    if (!box) {
      throw new Error('Missing text box')
    }
    await orcaPage.mouse.move(box.x - 6, box.y - 4)
    await orcaPage.mouse.down()
    await orcaPage.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 })
    await orcaPage.mouse.move(box.x + box.width + 6, box.y + box.height + 4, { steps: 4 })
    await orcaPage.mouse.up()

    const composer = orcaPage.locator('[data-pdf-note-composer]')
    await expect(composer).toContainText('needle result 1')
    await expect(composer).not.toContainText('needle result 2')
    const textarea = composer.getByPlaceholder('Add note for the AI')
    await expect(textarea).toBeFocused()
    await textarea.fill('Reword this result')
    await textarea.press('Enter')

    await expect(composer).toHaveCount(0)
    const badge = firstPage.locator('[data-pdf-note-badge]')
    await expect(badge).toHaveText('1')
    const saved = await orcaPage.evaluate((id) => {
      const notes = window.__store?.getState().getDiffComments(id) ?? []
      return notes.map(({ source, filePath, lineNumber, selectedText, body, pdfRegion }) => ({
        source,
        filePath,
        lineNumber,
        selectedText,
        body,
        page: pdfRegion?.page
      }))
    }, worktreeId)
    expect(saved).toEqual([
      {
        source: 'pdf',
        filePath: 'paper.pdf',
        lineNumber: 1,
        selectedText: 'needle result 1',
        body: 'Reword this result',
        page: 1
      }
    ])

    // The mark stays on its text through a zoom, which re-renders the page.
    await orcaPage.getByRole('button', { name: 'Zoom in' }).click()
    const region = firstPage.locator('[data-pdf-note-region]')
    await expect
      .poll(async () => {
        const [mark, text] = await Promise.all([region.boundingBox(), target.boundingBox()])
        return Boolean(
          mark &&
          text &&
          mark.x <= text.x + 1 &&
          mark.y <= text.y + 1 &&
          mark.x + mark.width >= text.x + text.width - 1 &&
          mark.y + mark.height >= text.y + text.height - 1
        )
      })
      .toBe(true)

    await badge.click()
    await expect(orcaPage.locator('.orca-diff-comment-card')).toContainText('Reword this result')
    await orcaPage.screenshot({ path: testInfo.outputPath('pdf-note-open.png') })
    await orcaPage.keyboard.press('Escape')
    await orcaPage.keyboard.press('Escape')
    await expect(orcaPage.locator('[data-pdf-annotate-hint]')).toHaveCount(0)
  })
})
