import { randomUUID } from 'node:crypto'
import { chmodSync, copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test, expect } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActiveTerminalManager } from './helpers/terminal'
import { runProcessSync } from '@orca/process-host'
import { resolvePinnedBunExecutable } from '../../config/scripts/pinned-bun-executable.mjs'
import {
  enableNativeChatSetting,
  seedClaudeProviderSession,
  toggleTerminalTabToChatView
} from './helpers/native-chat-transcript-fixture'

const providerLog = path.join(tmpdir(), `orca-image-provider-${randomUUID()}.jsonl`)
test.use({ orcaAppExtraEnv: { ORCA_BACKGROUND_LAUNCH: '1', ORCA_E2E_QUEUE_LOG: providerLog } })

for (const source of ['read', 'command', 'mcp', 'reply-path'] as const) {
  test(`shows a ${source} image without image Markdown or expanding the tool run`, async ({
    orcaPage: page,
    electronApp,
    testRepoPath,
    registerPostElectronShutdownCleanup
  }, testInfo) => {
    const sessionId = `tool-image-${randomUUID()}`
    const name = `iomcu-${randomUUID()}.png`
    const imagePath = path.join(testRepoPath, name)
    const scratch = mkdtempSync(path.join(tmpdir(), 'orca-tool-image-'))
    const transcriptPath = path.join(scratch, `${sessionId}.jsonl`)
    const stub = path.join(
      scratch,
      process.platform === 'win32' ? 'claude-fixture.exe' : 'claude-fixture'
    )
    const script = path.resolve('tests/e2e/fixtures/structured-claude-queue-stub.cjs')
    if (process.platform === 'win32') {
      const compiled = runProcessSync({
        program: resolvePinnedBunExecutable(process.cwd(), runProcessSync),
        args: ['build', '--compile', '--target=bun-windows-x64', script, '--outfile', stub],
        timeoutMs: 60_000
      })
      expect(compiled.code, compiled.stderr).toBe(0)
    } else {
      writeFileSync(stub, `#!/usr/bin/env node\nrequire(${JSON.stringify(script)});\n`)
      chmodSync(stub, 0o755)
    }
    registerPostElectronShutdownCleanup(async () => {
      rmSync(scratch, { recursive: true, force: true })
      rmSync(providerLog, { force: true })
    })
    copyFileSync(path.resolve('docs/site/public/docs/ways-to-run-run-on.png'), imagePath)
    const records =
      source === 'reply-path'
        ? [
            { type: 'user', content: [{ type: 'text', text: 'Show the result.' }] },
            {
              type: 'assistant',
              content: [{ type: 'text', text: `Image saved to \`${imagePath}\`.` }]
            }
          ]
        : [
            { type: 'user', content: [{ type: 'text', text: 'Inspect the screenshot.' }] },
            {
              type: 'assistant',
              content: [
                {
                  type: 'tool_use',
                  id: 'read-image',
                  name:
                    source === 'read'
                      ? 'Read'
                      : source === 'command'
                        ? 'Bash'
                        : 'mcp__plot__render',
                  input:
                    source === 'read' ? { file_path: imagePath } : { command: 'python plot.py' }
                }
              ]
            },
            {
              type: 'user',
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: 'read-image',
                  content:
                    source === 'read'
                      ? []
                      : [
                          {
                            type: 'text',
                            text: source === 'mcp' ? JSON.stringify({ path: imagePath }) : imagePath
                          }
                        ]
                }
              ]
            },
            {
              type: 'assistant',
              content: [{ type: 'text', text: 'The screenshot has been inspected.' }]
            }
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
      await page.evaluate(async (override) => {
        await window.__store
          ?.getState()
          .updateSettings({ uiLanguage: 'en', agentCmdOverrides: { claude: override } })
      }, stub)
      await enableNativeChatSetting(page)
      await seedClaudeProviderSession(page, { ...descriptor, sessionId, transcriptPath })
      await toggleTerminalTabToChatView(page, { tabId, worktreeId: descriptor.worktreeId })
      const chat = page.locator('[data-native-chat-root="true"]')
      const preview = chat.getByRole('button', { name: `View image: ${name}`, exact: true })
      await expect(preview).toBeVisible({ timeout: 30_000 })
      await expect(preview).toHaveCount(1)
      await expect(preview.locator('img')).toHaveJSProperty('complete', true)
      expect(
        await preview.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth)
      ).toBeGreaterThan(0)
      await expect
        .poll(async () => (await preview.locator('img').boundingBox())?.width ?? 0)
        .toBeGreaterThan(200)
      await preview.click()
      const dialog = page.getByRole('dialog', { name })
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('img')).toHaveJSProperty('complete', true)
      expect(
        await dialog.getByRole('img').evaluate((image: HTMLImageElement) => image.naturalWidth)
      ).toBeGreaterThan(0)
      await page.screenshot({
        path: testInfo.outputPath('tool-image-expanded.png'),
        animations: 'disabled'
      })
      await dialog.getByRole('button', { name: 'Close', exact: true }).click()
      await page.screenshot({
        path: testInfo.outputPath('tool-image-visible.png'),
        animations: 'disabled'
      })
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
    }
  })
}
