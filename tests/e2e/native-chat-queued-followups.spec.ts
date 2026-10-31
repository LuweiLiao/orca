import { randomUUID } from 'node:crypto'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { createChatOnHost } from './helpers/structured-claude-stub'
import { runProcessSync } from '@orca/process-host'
import { resolvePinnedBunExecutable } from '../../config/scripts/pinned-bun-executable.mjs'

const providerLog = path.join(tmpdir(), `orca-queue-provider-${randomUUID()}.jsonl`)

test.use({
  orcaAppExtraEnv: {
    ORCA_BACKGROUND_LAUNCH: '1',
    ORCA_E2E_QUEUE_LOG: providerLog
  }
})

test('queues Enter follow-ups, steers modified Enter and retains a draft on Stop', async ({
  orcaPage: page,
  electronApp
}, testInfo) => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'orca-queue-ui-'))
  const log = providerLog
  const script = path.resolve('tests/e2e/fixtures/structured-claude-queue-stub.cjs')
  const command = path.join(
    scratch,
    process.platform === 'win32' ? 'queue-stub.exe' : 'queue-stub.js'
  )
  if (process.platform === 'win32') {
    const built = runProcessSync({
      program: resolvePinnedBunExecutable(process.cwd(), runProcessSync),
      args: ['build', '--compile', '--target=bun-windows-x64', script, '--outfile', command],
      timeoutMs: 60_000
    })
    expect(built.code, built.stderr).toBe(0)
  } else {
    writeFileSync(command, `#!/usr/bin/env node\nrequire(${JSON.stringify(script)});\n`)
    chmodSync(command, 0o755)
  }
  writeFileSync(log, '')
  try {
    await waitForSessionReady(page)
    const worktreeId = await waitForActiveWorktree(page)
    await page.evaluate(async (override) => {
      await window.__store?.getState().updateSettings({
        uiLanguage: 'en',
        experimentalNativeChat: true,
        nativeChatQueueFollowUps: true,
        agentCmdOverrides: { claude: override }
      })
    }, command)
    const sessionId = await createChatOnHost(page, worktreeId)
    await expect
      .poll(() =>
        page.evaluate(
          ({ worktreeId, sessionId }) =>
            window.__store
              ?.getState()
              .unifiedTabsByWorktree[worktreeId]?.find((tab) => tab.entityId === sessionId)?.id,
          { worktreeId, sessionId }
        )
      )
      .toBeTruthy()
    const tabId = await page.evaluate(
      ({ worktreeId, sessionId }) =>
        window.__store
          ?.getState()
          .unifiedTabsByWorktree[worktreeId]?.find((tab) => tab.entityId === sessionId)?.id,
      { worktreeId, sessionId }
    )
    await page.locator(`[data-tab-id="${tabId}"]`).first().click()
    const chat = page.locator('[data-native-chat-root="true"]')
    const composer = chat.getByRole('textbox').first()
    const prompts = (): string[] =>
      readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .flatMap((line) => {
          const entry = JSON.parse(line)
          return (
            entry.prompt?.content?.flatMap((part: { type: string; text?: string }) =>
              part.type === 'text' && part.text ? [part.text] : []
            ) ?? []
          )
        })
    await composer.fill('slow initial task')
    await composer.press('Enter')
    await expect(chat.getByRole('button', { name: 'Stop the agent', exact: true })).toBeVisible({
      timeout: 30_000
    })
    await expect.poll(prompts, { timeout: 30_000 }).toEqual(['slow initial task'])
    await composer.fill('queued follow-up')
    await expect(chat.getByRole('button', { name: 'Send', exact: true })).toBeVisible()
    await composer.press('Enter')
    const cards = chat.getByRole('list', { name: 'Queued messages' })
    await expect(cards).toContainText('queued follow-up')
    expect(prompts()).toEqual(['slow initial task'])
    await chat.screenshot({ path: testInfo.outputPath('queue-card.png') })
    await composer.fill('immediate guidance')
    await composer.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')
    await expect
      .poll(prompts, { timeout: 30_000 })
      .toEqual(['slow initial task', 'immediate guidance', 'queued follow-up'])
    await expect(cards).toHaveCount(0)
    await composer.fill(`slow second task ${randomUUID()}`)
    await composer.press('Enter')
    await expect(chat.getByRole('button', { name: 'Stop the agent', exact: true })).toBeVisible()
    await composer.fill('keep this draft after stop')
    await composer.press('Escape')
    await expect(composer).toContainText('keep this draft after stop')
    await chat.screenshot({ path: testInfo.outputPath('stop-keeps-draft.png') })
    const windows = await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((window) => ({
        visible: window.isVisible(),
        focused: window.isFocused()
      }))
    )
    expect(windows.length).toBeGreaterThan(0)
    expect(windows.every((window) => !window.visible && !window.focused)).toBe(true)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
    rmSync(log, { force: true })
  }
})
