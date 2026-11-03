import { copyFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { runProcess } from '@orca/process-host'
import { test, expect } from './helpers/orca-app'
import { createChatOnHost } from './helpers/structured-claude-stub'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { startHiddenRendererFrameCapture } from './helpers/hidden-renderer-frame-capture'
import type { AgentImageDisplayReceipt } from '../../src/shared/agent-image-display'

test.use({ orcaAppExtraEnv: { ORCA_BACKGROUND_LAUNCH: '1' } })

test('image CLI publishes without an agent turn and receives a real renderer acknowledgement', async ({
  orcaPage: page,
  electronApp,
  testRepoPath
}, testInfo) => {
  await waitForSessionReady(page)
  const worktreeId = await waitForActiveWorktree(page)
  const stopCapture = await startHiddenRendererFrameCapture(page)
  const file = path.join(testRepoPath, 'cli-result.png')
  const corrupt = path.join(testRepoPath, 'cli-corrupt.png')
  const second = path.join(testRepoPath, 'cli-second.png')
  const third = path.join(testRepoPath, 'cli-third.png')
  copyFileSync(path.resolve('docs/site/public/docs/ways-to-run-run-on.png'), file)
  copyFileSync(path.resolve('package.json'), corrupt)
  copyFileSync(file, second)
  copyFileSync(file, third)
  try {
    await page.evaluate(async () => {
      await window
        .__store!.getState()
        .updateSettingsOrThrow({ uiLanguage: 'en', experimentalNativeChat: true })
    })
    const sessionId = await createChatOnHost(page, worktreeId)
    const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
    const cli = async (args: string[]): Promise<AgentImageDisplayReceipt> => {
      const result = await runProcess({
        program: process.execPath,
        args: [path.resolve('out/cli/index.js'), 'image', ...args, '--json'],
        cwd: testRepoPath,
        env: { ...process.env, ORCA_USER_DATA_PATH: userDataDir, ORCA_AGENT_SESSION_ID: sessionId },
        timeoutMs: 30_000
      })
      expect(result.code, `${result.stderr}\n${result.stdout}`).toBe(0)
      const response = JSON.parse(result.stdout)
      expect(response).toMatchObject({ ok: true })
      return response.result
    }
    const shown = await cli(['show', file, '--title', 'CLI plot', '--id', 'cli-plot'])
    expect(shown).toMatchObject({ sessionId, id: 'cli-plot', path: file })
    const tab = await page.evaluate(
      ({ worktreeId, sessionId }) =>
        window
          .__store!.getState()
          .unifiedTabsByWorktree[worktreeId]?.find((tab) => tab.entityId === sessionId)?.id,
      { worktreeId, sessionId }
    )
    if (!tab) {
      throw new Error('Chat tab was not published')
    }
    await page.locator(`[data-tab-id="${tab}"]`).first().click()
    const preview = page.getByRole('button', { name: 'View image: CLI plot', exact: true })
    await expect(preview).toBeVisible({ timeout: 30_000 })
    await expect.poll(async () => (await cli(['status', 'cli-plot'])).state).toBe('loaded')
    await cli(['show', file, '--title', 'CLI plot', '--id', 'cli-plot'])
    await expect(preview).toHaveCount(1)
    await preview.click()
    await expect(page.getByRole('dialog', { name: 'CLI plot' }).getByRole('img')).toHaveJSProperty(
      'complete',
      true
    )
    await page.screenshot({
      path: testInfo.outputPath('image-cli-loaded.png'),
      animations: 'disabled'
    })
    await page
      .getByRole('dialog', { name: 'CLI plot' })
      .getByRole('button', { name: 'Close', exact: true })
      .click()
    await cli(['show', second, '--title', 'Second plot', '--id', 'second'])
    await cli(['show', third, '--title', 'Third plot', '--id', 'third'])
    await preview.click()
    const gallery = page.getByRole('dialog')
    await expect(gallery.getByRole('button', { name: 'Previous image' })).toBeDisabled()
    await gallery.getByRole('button', { name: 'Next image' }).click()
    await expect(page.getByRole('dialog', { name: 'Second plot' })).toBeVisible()
    await expect(gallery.getByRole('img', { name: 'Second plot' })).toHaveJSProperty(
      'complete',
      true
    )
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('dialog', { name: 'Third plot' })).toBeVisible()
    await expect(gallery.getByRole('button', { name: 'Next image' })).toBeDisabled()
    await page.keyboard.press('ArrowLeft')
    await expect(page.getByRole('dialog', { name: 'Second plot' })).toBeVisible()
    await gallery.getByRole('button', { name: 'Zoom in' }).click()
    await gallery.getByRole('button', { name: 'Previous image' }).click()
    await expect(page.getByRole('dialog', { name: 'CLI plot' })).toBeVisible()
    await expect(gallery.getByRole('button', { name: 'Fit to screen' })).toBeDisabled()
    await page.screenshot({
      path: testInfo.outputPath('image-gallery-arrows.png'),
      animations: 'disabled'
    })
    await page.evaluate(() => window.__store!.getState().updateSettingsOrThrow({ theme: 'dark' }))
    await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setContentSize(720, 900)
    )
    await expect(gallery.getByRole('button', { name: 'Next image' })).toBeInViewport()
    await expect(gallery.getByRole('button', { name: 'Previous image' })).toBeInViewport()
    await page.screenshot({
      path: testInfo.outputPath('image-gallery-dark-narrow.png'),
      animations: 'disabled'
    })
    await page.keyboard.press('Escape')
    await expect(gallery).toHaveCount(0)
    await cli(['show', corrupt, '--id', 'bad-image'])
    await expect.poll(async () => (await cli(['status', 'bad-image'])).state).toBe('failed')
    await page.reload()
    await waitForSessionReady(page)
    expect(await cli(['status', 'cli-plot'])).toMatchObject({ state: 'loaded' })
    const windows = await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((window) => ({
        visible: window.isVisible(),
        focused: window.isFocused()
      }))
    )
    expect(windows.every((window) => !window.visible && !window.focused)).toBe(true)
  } finally {
    await stopCapture()
    rmSync(file, { force: true })
    rmSync(corrupt, { force: true })
    rmSync(second, { force: true })
    rmSync(third, { force: true })
  }
})
