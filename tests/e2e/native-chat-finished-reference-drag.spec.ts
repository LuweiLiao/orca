import { test, expect } from './helpers/orca-app'
import { createChatOnHost } from './helpers/structured-claude-stub'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { startHiddenRendererFrameCapture } from './helpers/hidden-renderer-frame-capture'
import { structuredAgentSessionPaneKey } from '../../src/shared/structured-agent-session-projection'
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { runProcessSync } from '@orca/process-host'
import { resolvePinnedBunExecutable } from '../../config/scripts/pinned-bun-executable.mjs'

const providerLog = path.join(tmpdir(), `orca-reference-drag-${randomUUID()}.jsonl`)
test.use({ orcaAppExtraEnv: { ORCA_BACKGROUND_LAUNCH: '1', ORCA_E2E_QUEUE_LOG: providerLog } })

test('drags a finished chat without live metadata from the sidebar into a different chat', async ({
  orcaPage: page,
  electronApp,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  await waitForSessionReady(page)
  const worktreeId = await waitForActiveWorktree(page)
  const stopCapture = await startHiddenRendererFrameCapture(page)
  const scratch = mkdtempSync(path.join(tmpdir(), 'orca-reference-drag-'))
  const script = path.resolve('tests/e2e/fixtures/structured-claude-queue-stub.cjs')
  const command = path.join(
    scratch,
    process.platform === 'win32' ? 'claude-fixture.exe' : 'claude-fixture'
  )
  if (process.platform === 'win32') {
    const compiled = runProcessSync({
      program: resolvePinnedBunExecutable(process.cwd(), runProcessSync),
      args: ['build', '--compile', '--target=bun-windows-x64', script, '--outfile', command],
      timeoutMs: 60000
    })
    expect(compiled.code, compiled.stderr).toBe(0)
  } else {
    writeFileSync(command, `#!/usr/bin/env node\nrequire(${JSON.stringify(script)});\n`)
    chmodSync(command, 0o755)
  }
  registerPostElectronShutdownCleanup(async () => {
    rmSync(scratch, { recursive: true, force: true })
    rmSync(providerLog, { force: true })
  })
  try {
    await page.evaluate(async (command) => {
      await window.__store!.getState().updateSettingsOrThrow({
        experimentalNativeChat: true,
        uiLanguage: 'en',
        agentCmdOverrides: { claude: command }
      })
      window.__store!.setState({ sidebarOpen: true, agentActivityDisplayMode: 'compact' })
    }, command)
    const sourceId = await createChatOnHost(page, worktreeId)
    const sourceTabId = await page.evaluate(
      ({ sourceId, worktreeId }) =>
        window
          .__store!.getState()
          .unifiedTabsByWorktree[worktreeId]?.find((tab) => tab.entityId === sourceId)?.id,
      { sourceId, worktreeId }
    )
    await page.locator(`[data-tab-id="${sourceTabId}"]`).first().click()
    const sourceInput = page
      .locator('[data-native-chat-root="true"]:visible')
      .getByRole('textbox')
      .last()
    await sourceInput.fill('Finished reference test source')
    await sourceInput.press('Enter')
    await expect(
      page
        .locator('[data-native-chat-root="true"]:visible')
        .getByText('Stub reply.', { exact: true })
    ).toBeVisible({ timeout: 30000 })
    const targetId = await createChatOnHost(page, worktreeId)
    const tabs = await page.evaluate(
      ({ worktreeId, sourceId, targetId }) => {
        const rows = window.__store!.getState().unifiedTabsByWorktree[worktreeId] ?? []
        return {
          source: rows.find((row) => row.entityId === sourceId),
          target: rows.find((row) => row.entityId === targetId)
        }
      },
      { worktreeId, sourceId, targetId }
    )
    if (!tabs.source || !tabs.target) {
      throw new Error('Chat tabs missing')
    }
    await page.locator(`[data-tab-id="${tabs.target.id}"]`).first().click()
    const title = 'Finished chat reference source'
    const paneKey = structuredAgentSessionPaneKey(tabs.source.id, sourceId)
    await page.evaluate(
      ({ worktreeId, sourceTabId, paneKey, title }) => {
        const store = window.__store!
        const state = store.getState()
        store.setState({
          unifiedTabsByWorktree: {
            ...state.unifiedTabsByWorktree,
            [worktreeId]: state.unifiedTabsByWorktree[worktreeId]!.map((tab) =>
              tab.id === sourceTabId ? { ...tab, customLabel: title } : tab
            )
          }
        })
        const latest = store.getState()
        store.setState({
          agentStatusByPaneKey: {
            ...latest.agentStatusByPaneKey,
            [paneKey]: {
              ...latest.agentStatusByPaneKey[paneKey],
              structuredHostOwned: undefined,
              providerSession: undefined
            }
          }
        })
      },
      { worktreeId, sourceTabId: tabs.source.id, paneKey, title }
    )
    const input = page.locator('[data-native-chat-root="true"]:visible').getByRole('textbox').last()
    await input.fill('Keep this existing draft. ')
    const row = page.locator('.compact-agent-row').filter({ hasText: title }).first()
    await expect(row).toBeVisible()
    await expect(row).toHaveAttribute('draggable', 'true')
    expect(
      await page.evaluate((paneKey) => {
        const entry = window.__store!.getState().agentStatusByPaneKey[paneKey]
        return {
          liveOwner: Boolean(entry?.structuredHostOwned),
          provider: Boolean(entry?.providerSession)
        }
      }, paneKey)
    ).toEqual({ liveOwner: false, provider: false })
    await row.dragTo(input, { sourcePosition: { x: 45, y: 10 } })
    const reference = page.locator(
      '[data-conversation-reference-drop]:visible [data-native-chat-conversation-reference]'
    )
    await expect(reference).toHaveCount(1)
    await expect(reference).toContainText(title)
    await expect(input).toContainText('Keep this existing draft.')
    const uri = await reference.getAttribute('data-native-chat-conversation-reference')
    if (!uri) {
      throw new Error('Reference URI missing')
    }
    const read = await page.evaluate(
      (reference) => window.api.aiVault.readConversationReference({ reference, limit: 10 }),
      uri
    )
    expect(read.reference.title).toBe(title)
    expect(read.reference.agent).toBe('claude')
    expect(read.messages.some((message) => message.text.includes('Stub reply.'))).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath('finished-chat-drag-reference.png'),
      animations: 'disabled'
    })
    const windows = await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((window) => ({
        visible: window.isVisible(),
        focused: window.isFocused()
      }))
    )
    expect(windows.every((window) => !window.visible && !window.focused)).toBe(true)
  } finally {
    await stopCapture()
  }
})
