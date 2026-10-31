import { randomUUID } from 'node:crypto'
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test, expect } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActiveTerminalManager } from './helpers/terminal'
import {
  enableNativeChatSetting,
  seedClaudeProviderSession,
  toggleTerminalTabToChatView
} from './helpers/native-chat-transcript-fixture'

test.use({ orcaAppExtraEnv: { ORCA_BACKGROUND_LAUNCH: '1' } })

test('shows a read image without Markdown or expanding the tool run', async ({
  orcaPage: page,
  electronApp,
  testRepoPath
}, testInfo) => {
  const sessionId = `tool-image-${randomUUID()}`
  const name = `iomcu-${randomUUID()}.png`
  const imagePath = path.join(testRepoPath, name)
  const scratch = mkdtempSync(path.join(tmpdir(), 'orca-tool-image-'))
  const transcriptPath = path.join(scratch, `${sessionId}.jsonl`)
  copyFileSync(path.resolve('docs/site/public/docs/ways-to-run-run-on.png'), imagePath)
  const records = [
    { type: 'user', content: [{ type: 'text', text: 'Inspect the screenshot.' }] },
    {
      type: 'assistant',
      content: [
        { type: 'tool_use', id: 'read-image', name: 'Read', input: { file_path: imagePath } }
      ]
    },
    { type: 'user', content: [{ type: 'tool_result', tool_use_id: 'read-image', content: [] }] },
    { type: 'assistant', content: [{ type: 'text', text: 'The screenshot has been inspected.' }] }
  ]
  writeFileSync(
    transcriptPath,
    `${records
      .map((record, index) =>
        JSON.stringify({
          type: record.type,
          sessionId,
          uuid: `${sessionId}-${index}`,
          timestamp: new Date(Date.now() + index * 100).toISOString(),
          message: { role: record.type, content: record.content }
        })
      )
      .join('\n')}\n`
  )

  try {
    await waitForSessionReady(page)
    await waitForActiveWorktree(page)
    await ensureTerminalVisible(page)
    await waitForActiveTerminalManager(page)
    const descriptor = await waitForActivePaneHookDescriptor(page)
    const [tabId] = descriptor.paneKey.split(':')
    await page.evaluate(async () => {
      await window.__store?.getState().updateSettings({ uiLanguage: 'en' })
    })
    await enableNativeChatSetting(page)
    await seedClaudeProviderSession(page, { ...descriptor, sessionId, transcriptPath })
    await toggleTerminalTabToChatView(page, { tabId, worktreeId: descriptor.worktreeId })
    const chat = page.locator('[data-native-chat-root="true"]')
    const preview = chat.getByRole('button', { name: `View image: ${name}`, exact: true })
    await expect(preview).toBeVisible({ timeout: 30_000 })
    await expect(preview.locator('img')).toHaveJSProperty('complete', true)
    expect(
      await preview.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth)
    ).toBeGreaterThan(0)
    await preview.click()
    const dialog = page.getByRole('dialog', { name })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('img')).toHaveJSProperty('complete', true)
    expect(
      await dialog.getByRole('img').evaluate((image: HTMLImageElement) => image.naturalWidth)
    ).toBeGreaterThan(0)
    await dialog.screenshot({ path: testInfo.outputPath('tool-image-expanded.png') })
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await chat.screenshot({ path: testInfo.outputPath('tool-image-visible.png') })
    await page.reload()
    await waitForSessionReady(page)
    await waitForActiveWorktree(page)
    await waitForActiveTerminalManager(page)
    const restored = await waitForActivePaneHookDescriptor(page)
    await seedClaudeProviderSession(page, { ...restored, sessionId, transcriptPath })
    const [restoredTabId] = restored.paneKey.split(':')
    await page.evaluate(
      ({ worktreeId, tabId }) => {
        const state = window.__store?.getState()
        const tab = state?.unifiedTabsByWorktree[worktreeId]?.find(
          (tab) => tab.contentType === 'terminal' && tab.entityId === tabId
        )
        if (tab && tab.viewMode !== 'chat') {
          state?.toggleTabViewMode(tab.id)
        }
      },
      { worktreeId: restored.worktreeId, tabId: restoredTabId }
    )
    await expect(preview).toBeVisible({ timeout: 30_000 })
    const windows = await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((window) => ({
        visible: window.isVisible(),
        focused: window.isFocused()
      }))
    )
    expect(windows.length).toBeGreaterThan(0)
    expect(windows.every((window) => !window.visible && !window.focused)).toBe(true)
  } finally {
    rmSync(imagePath, { force: true })
    rmSync(scratch, { recursive: true, force: true })
  }
})
