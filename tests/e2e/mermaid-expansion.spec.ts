import { writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { test, expect } from './helpers/orca-app'
import { startHiddenRendererFrameCapture } from './helpers/hidden-renderer-frame-capture'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

test.use({ orcaAppExtraEnv: { ORCA_BACKGROUND_LAUNCH: '1' } })

for (const theme of ['light', 'dark'] as const) {
  test(`Mermaid expands from preview, rich text and diagram files (${theme})`, async ({
    orcaPage: page,
    testRepoPath
  }, testInfo) => {
    await waitForSessionReady(page)
    const worktreeId = await waitForActiveWorktree(page)
    const stopCapture = await startHiddenRendererFrameCapture(page)
    const source = 'graph LR\nA[Source] --> B[Expanded diagram]\nB --> C[Finish]\n'
    const markdown = path.join(testRepoPath, 'expand-diagram.md')
    const diagram = path.join(testRepoPath, 'expand-diagram.mmd')
    await writeFile(markdown, `# Diagram\n\n\`\`\`mermaid\n${source}\`\`\`\n`)
    await writeFile(diagram, source)
    try {
      await page.evaluate(async (selectedTheme) => {
        await window
          .__store!.getState()
          .updateSettingsOrThrow({ uiLanguage: 'en', theme: selectedTheme })
      }, theme)
      for (const mode of ['preview', 'rich', 'diagram'] as const) {
        await page.evaluate(
          ({ markdown, diagram, mode, worktreeId }) => {
            const state = window.__store!.getState()
            const filePath = mode === 'diagram' ? diagram : markdown
            const file = {
              filePath,
              relativePath: mode === 'diagram' ? 'expand-diagram.mmd' : 'expand-diagram.md',
              worktreeId,
              language: mode === 'diagram' ? 'mermaid' : 'markdown'
            }
            if (mode === 'preview') {
              state.openMarkdownPreview(file)
            } else {
              state.openFile({ ...file, mode: 'edit' })
            }
          },
          { markdown, diagram, mode, worktreeId }
        )
        await expect
          .poll(() =>
            page.evaluate(() => {
              const state = window.__store!.getState()
              return state.openFiles.find((file) => file.id === state.activeFileId)?.filePath
            })
          )
          .toBe(mode === 'diagram' ? diagram : markdown)
        if (mode !== 'preview') {
          await page.evaluate(() => {
            const state = window.__store!.getState()
            if (!state.activeFileId) {
              throw new Error('File did not open')
            }
            state.setMarkdownViewMode(state.activeFileId, 'rich')
          })
        }
        const surface = page.locator(
          mode === 'diagram'
            ? '.mermaid-viewer'
            : mode === 'rich'
              ? '.rich-markdown-editor'
              : '.markdown-preview'
        )
        await expect(surface.locator('.mermaid-block svg')).toBeVisible({ timeout: 30_000 })
        await surface.getByRole('button', { name: 'Expand diagram', exact: true }).click()
        const dialog = page.getByRole('dialog', { name: 'Diagram', exact: true })
        const image = dialog.getByRole('img', { name: 'Diagram', exact: true })
        await expect(image).toHaveJSProperty('complete', true)
        await expect
          .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
          .toBeGreaterThan(0)
        const original = await image.boundingBox()
        if (!original) {
          throw new Error('Diagram has no visible bounds')
        }
        await dialog.getByRole('button', { name: 'Zoom in', exact: true }).click()
        await expect
          .poll(async () => (await image.boundingBox())?.width ?? 0)
          .toBeGreaterThan(original.width)
        const transform = await image.evaluate((element) => element.style.transform)
        const canvas = await dialog.getByTestId('pan-zoom-image-canvas').boundingBox()
        if (!canvas) {
          throw new Error('Canvas has no bounds')
        }
        await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2)
        await page.mouse.down()
        await page.mouse.move(canvas.x + canvas.width / 2 + 60, canvas.y + canvas.height / 2 + 30, {
          steps: 4
        })
        await page.mouse.up()
        await expect
          .poll(() => image.evaluate((element) => element.style.transform))
          .not.toBe(transform)
        await dialog.screenshot({ path: testInfo.outputPath(`${mode}-${theme}-expanded.png`) })
        await dialog.getByRole('button', { name: 'Close', exact: true }).click()
        await expect(dialog).toHaveCount(0)
      }
    } finally {
      await stopCapture()
      await Promise.all([rm(markdown, { force: true }), rm(diagram, { force: true })])
    }
  })
}
