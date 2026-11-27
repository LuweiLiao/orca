import { writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from '../../desktop/electron-fixtures/orca-app'
import { expect } from '@stablyai/playwright-test'
import { createPdfFindFixture } from '../pdf/pdf-find-fixture'

test.describe('Review notes on any document', () => {
  test.use({ seedTestRepo: false })

  test('notes a selected line of a .tex file and keeps a typed PDF draft across marking mode', async ({
    orcaPage,
    registerPostElectronShutdownCleanup
  }, testInfo) => {
    await orcaPage.setViewportSize({ width: 1280, height: 900 })
    const folderPath = mkdtempSync(path.join(os.tmpdir(), 'orca-text-notes-'))
    writeFileSync(
      path.join(folderPath, 'method.tex'),
      '\\section{Method}\nWe fix the bar to the gripper.\nThen we lift it.\n'
    )
    writeFileSync(path.join(folderPath, 'paper.pdf'), createPdfFindFixture())
    registerPostElectronShutdownCleanup(async () =>
      rmSync(folderPath, { recursive: true, force: true })
    )
    const worktreeId = await orcaPage.evaluate(async (folderPath) => {
      const state = window.__store?.getState()
      if (!state) {
        throw new Error('Missing fixture store')
      }
      // Button names below are the English copy, whatever the machine's language.
      await state.updateSettingsOrThrow({ uiLanguage: 'en' })
      const group = await window.api.projectGroups.create({
        name: 'Text notes fixture',
        parentPath: folderPath,
        createdFrom: 'folder-scan'
      })
      await state.fetchProjectGroups({ runtimeEnvironmentId: null, throwOnError: true })
      const folder = await state.createFolderWorkspace(
        { projectGroupId: group.id, name: 'Text notes', folderPath },
        { runtimeEnvironmentId: null }
      )
      if (!folder) {
        throw new Error('Missing fixture folder')
      }
      const id = `folder:${folder.folderWorkspace.id}`
      state.setActiveWorktree(id)
      state.openFile({
        filePath: `${folderPath}/method.tex`,
        relativePath: 'method.tex',
        worktreeId: id,
        language: 'latex',
        mode: 'edit'
      })
      return id
    }, folderPath)

    const editor = orcaPage.locator('.monaco-editor').filter({ hasText: 'We fix the bar' }).first()
    await editor
      .locator('.view-line')
      .filter({ hasText: 'We fix the bar' })
      .click({ clickCount: 3 })
    await orcaPage.getByRole('button', { name: 'Add note on selected text' }).click()
    const textarea = orcaPage.locator('.orca-diff-comment-popover-textarea')
    await expect(textarea).toBeFocused()
    await textarea.fill('Cite the gripper paper')
    await textarea.press('Enter')
    await expect(textarea).toHaveCount(0)

    const saved = await orcaPage.evaluate((id) => {
      const notes = window.__store?.getState().getDiffComments(id) ?? []
      return notes.map(({ source, filePath, lineNumber, body }) => ({
        source,
        filePath,
        lineNumber,
        body
      }))
    }, worktreeId)
    expect(saved).toEqual([
      { source: 'markdown', filePath: 'method.tex', lineNumber: 2, body: 'Cite the gripper paper' }
    ])
    await orcaPage.screenshot({ path: testInfo.outputPath('tex-note-saved.png') })

    await orcaPage.evaluate(
      ({ id, folderPath }) => {
        window.__store?.getState().openFile({
          filePath: `${folderPath}/paper.pdf`,
          relativePath: 'paper.pdf',
          worktreeId: id,
          language: 'plaintext',
          mode: 'edit'
        })
      },
      { id: worktreeId, folderPath }
    )
    const firstPage = orcaPage.locator('.pdfViewer .page').first()
    const target = firstPage.locator('.textLayer span', { hasText: 'needle result 1' })
    await expect(target).toBeVisible()
    const markButton = orcaPage.getByRole('button', { name: 'Mark a region to note' })
    await markButton.click()
    const box = await target.boundingBox()
    if (!box) {
      throw new Error('Missing text box')
    }
    await orcaPage.mouse.move(box.x - 6, box.y - 4)
    await orcaPage.mouse.down()
    await orcaPage.mouse.move(box.x + box.width + 6, box.y + box.height + 4, { steps: 6 })
    await orcaPage.mouse.up()
    const composer = orcaPage.locator('[data-pdf-note-composer]')
    await composer.getByPlaceholder('Add note for the AI').fill('Half-written note')

    await markButton.click()
    await expect(composer).toHaveCount(0)
    await markButton.click()
    await expect(composer.getByPlaceholder('Add note for the AI')).toHaveValue('Half-written note')
  })
})
