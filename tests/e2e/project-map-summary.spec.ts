import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { expect } from './helpers/orca-app'
import { SUPPORTED, createChatOnHost, test } from './helpers/structured-claude-stub'
import { buildFakeAgentCommandOverride } from './helpers/fake-agent-command-override'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { startHiddenRendererFrameCapture } from './helpers/hidden-renderer-frame-capture'
import {
  structuredAgentSessionPaneKey,
  structuredAgentSessionTabId
} from '../../src/shared/structured-agent-session-projection'

test.use({ orcaAppExtraEnv: { ORCA_E2E_STUB_EFFORT_CATALOG: '1' } })

const paneKeyOf = (sessionId: string): string =>
  structuredAgentSessionPaneKey(structuredAgentSessionTabId(sessionId), sessionId)

const promptFrame = z.object({
  prompt: z.object({ content: z.array(z.object({ type: z.literal('text'), text: z.string() })) })
})

function sentPrompts(launchLog: string): string[] {
  return readFileSync(launchLog, 'utf8')
    .trim()
    .split('\n')
    .flatMap((line) => {
      const frame = promptFrame.safeParse(JSON.parse(line))
      return frame.success ? [frame.data.prompt.content.map(({ text }) => text).join('\n')] : []
    })
}

test('summarizes a chat on request, edits it, hands off with it, and greys out on an old host', async ({
  orcaPage: page,
  claudeStub,
  electronApp
}, testInfo) => {
  test.skip(!SUPPORTED, 'the Claude stub wrapper is POSIX-only')
  test.setTimeout(300_000)
  await waitForSessionReady(page)
  const stopCapture = await startHiddenRendererFrameCapture(page)
  try {
    await page.setViewportSize({ width: 1440, height: 960 })
    const worktreeId = await waitForActiveWorktree(page)

    // The stand-in for the model: reads the request on stdin, records it, prints a fixed summary.
    const dir = testInfo.outputPath('summary-model')
    mkdirSync(dir, { recursive: true })
    const requests = path.join(dir, 'requests.log')
    const slow = path.join(dir, 'slow')
    const script = path.join(dir, 'summarize.sh')
    writeFileSync(
      script,
      `#!/bin/sh\ncat >> "${requests}"\necho '=====' >> "${requests}"\n[ -f "${slow}" ] && sleep 60\nprintf 'STUB-SUMMARY: lanes and wires'\n`
    )
    chmodSync(script, 0o755)

    await page.evaluate(
      async ({ command, script: customAgentCommand }) => {
        const store = window.__store!
        const sourceControlAi = store.getState().settings!.sourceControlAi
        await store.getState().updateSettings({
          uiLanguage: 'en',
          experimentalNativeChat: true,
          defaultTuiAgent: 'claude',
          tabAutoGenerateTitle: false,
          nativeChatAutoName: false,
          agentCmdOverrides: { claude: command },
          sourceControlAi: {
            ...sourceControlAi,
            enabled: true,
            agentId: 'custom',
            customAgentCommand,
            actions: {}
          }
        })
      },
      { command: buildFakeAgentCommandOverride(claudeStub.command), script }
    )

    const send = async (sessionId: string, text: string, replies: number): Promise<void> => {
      await page.evaluate(() => window.__store!.getState().closeProjectMapPage())
      const tab = page.locator(
        `[data-testid="sortable-tab"][data-tab-id="${structuredAgentSessionTabId(sessionId)}"]`
      )
      await expect(tab).toBeVisible({ timeout: 30_000 })
      await tab.click()
      const chat = page.locator('[data-native-chat-root="true"]')
      await chat.getByRole('textbox').fill(text)
      await chat.getByRole('textbox').press('Enter')
      await expect(chat.getByText('Stub reply.', { exact: true })).toHaveCount(replies, {
        timeout: 30_000
      })
    }
    const mainId = await createChatOnHost(page, worktreeId)
    await send(mainId, 'FIRST-TURN: sketch the lanes', 1)
    const finishedId = await createChatOnHost(page, worktreeId)
    await send(finishedId, 'FINISHED-CHAT: tidy the legend', 1)

    await page.evaluate(() => window.__store!.getState().openProjectMapPage())
    const map = page.locator('.project-map')
    const node = (sessionId: string) =>
      map.locator(`[data-project-map-node="${paneKeyOf(sessionId)}"]`)
    const history = map.locator('[data-project-map-node][data-history="true"]')
    const menu = page.locator('[data-slot="context-menu-content"]')
    const action = (id: string) => menu.locator(`[data-project-map-action="${id}"]`)
    const panel = map.locator('[data-project-map-summary]')
    const text = panel.locator('[data-project-map-summary-text]')
    const marker = (sessionId: string) =>
      node(sessionId).locator('[data-project-map-summary-marker]')
    await expect(node(mainId)).toBeVisible({ timeout: 30_000 })

    const artifacts = path.join(process.cwd(), 'test-results', 'project-map-summary')
    mkdirSync(artifacts, { recursive: true })
    const screenshot = async (name: string): Promise<void> => {
      const file = path.join(artifacts, `${name}.png`)
      await page.screenshot({ path: file, animations: 'disabled' })
      await testInfo.attach(name, { path: file, contentType: 'image/png' })
    }

    // Opening the panel costs nothing: no model call until Generate is pressed.
    await node(mainId).click({ button: 'right' })
    await expect(action('summary')).toContainText('Generate summary')
    await expect(action('summary')).toBeEnabled()
    await action('summary').click()
    await expect(panel).toBeVisible()
    await expect(panel).toContainText('No summary yet.')
    await expect(panel).toContainText('may cost money')
    expect(existsSync(requests)).toBe(false)
    await screenshot('panel-empty')

    await panel.locator('[data-project-map-summary-generate]').click()
    await expect(text).toHaveValue('STUB-SUMMARY: lanes and wires', { timeout: 30_000 })
    expect(readFileSync(requests, 'utf8')).toContain('FIRST-TURN: sketch the lanes')
    await expect(marker(mainId)).toBeVisible()
    await screenshot('panel-generated')

    // The result is editable and the edit is kept on the host.
    await text.fill('EDITED-SUMMARY: lanes, wires and a legend')
    await panel.locator('[data-project-map-summary-save]').click()
    await expect(panel).toContainText('Edited by you')
    const saved = await page.evaluate(
      (sessionId) =>
        window.api.runtime.call({ method: 'agentSession.summaryRead', params: { sessionId } }),
      mainId
    )
    expect(JSON.stringify(saved)).toContain('EDITED-SUMMARY')

    // A new message makes it out of date, and the menu now offers to view it.
    await panel.getByRole('button', { name: 'Close' }).click()
    await send(mainId, 'SECOND-TURN: colour the wires', 2)
    await page.evaluate(() => window.__store!.getState().openProjectMapPage())
    await node(mainId).click({ button: 'right' })
    await expect(action('summary')).toContainText('View summary')
    await action('summary').click()
    await expect(panel.locator('[data-project-map-summary-stale]')).toBeVisible()
    await screenshot('panel-stale')

    // Regenerating can be canceled while the model runs; the saved text stays.
    writeFileSync(slow, '')
    await panel.locator('[data-project-map-summary-generate]').click()
    await expect(panel.locator('[data-project-map-summary-cancel]')).toBeVisible()
    await screenshot('panel-generating')
    await panel.locator('[data-project-map-summary-cancel]').click()
    await expect(panel.locator('[data-project-map-summary-generate]')).toBeVisible({
      timeout: 15_000
    })
    await expect(text).toHaveValue('EDITED-SUMMARY: lanes, wires and a legend')
    await panel.getByRole('button', { name: 'Close' }).click()

    // The summary becomes the first message of a handoff.
    await node(mainId).click({ button: 'right' })
    await action('new-child').click()
    const fork = map.locator('[data-project-map-fork-panel]')
    await expect(fork).toBeVisible()
    await expect(fork).toContainText('out of date')
    await fork.locator('[data-project-map-fork-use-summary]').check()
    await fork.getByRole('textbox').fill('HANDOFF-GO: continue')
    await screenshot('fork-with-summary')
    await fork.getByRole('button', { name: 'Create child chat' }).click()
    await expect(fork).toHaveCount(0)
    await expect
      .poll(() => sentPrompts(claudeStub.launchLog).find((prompt) => prompt.includes('HANDOFF-GO')))
      .toBeTruthy()
    const handoff = sentPrompts(claudeStub.launchLog).find((prompt) =>
      prompt.includes('HANDOFF-GO')
    )!
    expect(handoff).toContain('Summary of the previous chat:')
    expect(handoff).toContain('EDITED-SUMMARY: lanes, wires and a legend')
    expect(handoff.indexOf('EDITED-SUMMARY')).toBeLessThan(handoff.indexOf('HANDOFF-GO'))

    // A chat that was closed still draws as a grey node and can be summarized.
    rmSync(slow, { force: true })
    await node(finishedId).click({ button: 'right' })
    await menu.locator('[data-project-map-action="close"]').click()
    await expect(history).toHaveCount(1, { timeout: 30_000 })
    await history.click({ button: 'right' })
    await expect(action('summary')).toBeEnabled()
    await action('summary').click()
    await panel.locator('[data-project-map-summary-generate]').click()
    await expect(text).toHaveValue('STUB-SUMMARY: lanes and wires', { timeout: 30_000 })
    expect(readFileSync(requests, 'utf8')).toContain('FINISHED-CHAT: tidy the legend')
    await expect(history.locator('[data-project-map-summary-marker]')).toBeVisible()
    await screenshot('closed-chat-summary')
    await panel.getByRole('button', { name: 'Close' }).click()

    // A host that predates summaries greys the item out and says why; nothing runs locally.
    const calls = readFileSync(requests, 'utf8').split('=====').length
    await electronApp.evaluate(({ ipcMain }) => {
      const handlers: unknown = Reflect.get(ipcMain, '_invokeHandlers')
      const original = handlers instanceof Map ? handlers.get('runtime:getStatus') : undefined
      if (!(handlers instanceof Map) || typeof original !== 'function') {
        throw new Error('runtime:getStatus handler missing')
      }
      handlers.set('runtime:getStatus', async (event: unknown, ...args: unknown[]) => {
        const status = await original(event, ...args)
        const names: unknown = status?.capabilities
        return {
          ...status,
          capabilities: Array.isArray(names)
            ? names.filter((name) => name !== 'conversation.summary.v1')
            : names
        }
      })
    })
    await page.reload()
    await waitForSessionReady(page)
    await page.evaluate(() => window.__store!.getState().openProjectMapPage())
    await expect(node(mainId)).toBeVisible({ timeout: 30_000 })
    await node(mainId).click({ button: 'right' })
    await expect(action('summary')).toBeDisabled()
    await expect(action('summary')).toContainText('This host is too old to summarize chats')
    await screenshot('menu-old-host')
    await page.keyboard.press('Escape')
    await expect(marker(mainId)).toHaveCount(0)
    expect(readFileSync(requests, 'utf8').split('=====').length).toBe(calls)
  } finally {
    await stopCapture()
  }
})
