import { mkdirSync } from 'node:fs'
import path from 'node:path'
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

test('closes, reopens, hides and undoes map nodes, confirming a running chat first', async ({
  orcaPage: page,
  claudeStub
}, testInfo) => {
  test.skip(!SUPPORTED, 'the Claude stub wrapper is POSIX-only')
  test.setTimeout(300_000)
  await waitForSessionReady(page)
  const stopCapture = await startHiddenRendererFrameCapture(page)
  try {
    await page.setViewportSize({ width: 1440, height: 960 })
    const worktreeId = await waitForActiveWorktree(page)
    await page.evaluate(async (command) => {
      await window.__store!.getState().updateSettings({
        uiLanguage: 'en',
        experimentalNativeChat: true,
        defaultTuiAgent: 'claude',
        tabAutoGenerateTitle: false,
        agentCmdOverrides: { claude: command }
      })
    }, buildFakeAgentCommandOverride(claudeStub.command))

    const send = async (sessionId: string, text: string): Promise<void> => {
      const tab = page.locator(
        `[data-testid="sortable-tab"][data-tab-id="${structuredAgentSessionTabId(sessionId)}"]`
      )
      await expect(tab).toBeVisible({ timeout: 30_000 })
      await tab.click()
      const chat = page.locator('[data-native-chat-root="true"]')
      await chat.getByRole('textbox').fill(text)
      await chat.getByRole('button', { name: 'Send', exact: true }).click()
    }
    const idleId = await createChatOnHost(page, worktreeId)
    await send(idleId, 'Plan the close actions')
    await expect(
      page.locator('[data-native-chat-root="true"]').getByText('Stub reply.', { exact: true })
    ).toBeVisible()
    const busyId = await createChatOnHost(page, worktreeId)
    await send(busyId, 'slow work that keeps running')

    const hasTab = (sessionId: string): Promise<boolean> =>
      page.evaluate(
        (id) =>
          Object.values(window.__store!.getState().unifiedTabsByWorktree).some((tabs) =>
            tabs.some((tab) => tab.id === id)
          ),
        structuredAgentSessionTabId(sessionId)
      )

    await page.evaluate(() => window.__store!.getState().openProjectMapPage())
    const map = page.locator('.project-map')
    const node = (sessionId: string) =>
      map.locator(`[data-project-map-node="${paneKeyOf(sessionId)}"]`)
    const history = map.locator('[data-project-map-node][data-history="true"]')
    const idleNode = node(idleId)
    const busyNode = node(busyId)
    await expect(idleNode).toBeVisible({ timeout: 30_000 })
    await expect(busyNode).toBeVisible()
    const menu = page.locator('[data-slot="context-menu-content"]')
    const action = (id: string) => menu.locator(`[data-project-map-action="${id}"]`)
    const toast = page.locator('[data-sonner-toast]')

    const artifacts = path.join(process.cwd(), 'test-results', 'project-map-close')
    mkdirSync(artifacts, { recursive: true })
    const screenshot = async (name: string): Promise<void> => {
      const file = path.join(artifacts, `${name}.png`)
      await page.screenshot({ path: file, animations: 'disabled' })
      await testInfo.attach(name, { path: file, contentType: 'image/png' })
    }
    const closeIdle = async (): Promise<void> => {
      await idleNode.click({ button: 'right' })
      await action('close').click()
    }

    // An idle chat closes without a prompt, leaves a grey node and offers an undo.
    await closeIdle()
    await expect(history).toHaveCount(1, { timeout: 30_000 })
    await expect(idleNode).toHaveCount(0)
    expect(await hasTab(idleId)).toBe(false)
    await expect(toast).toContainText('Closed')
    await screenshot('closed-grey-node')
    await toast.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => hasTab(idleId), { timeout: 30_000 }).toBe(true)
    await expect(history).toHaveCount(0, { timeout: 30_000 })
    await expect(idleNode).toBeVisible()

    // Ctrl+Z on the map takes the close back the same way.
    await closeIdle()
    await expect(history).toHaveCount(1, { timeout: 30_000 })
    await map.locator('.project-map-viewport').click({ position: { x: 8, y: 8 } })
    await page.keyboard.press('Control+z')
    await expect.poll(() => hasTab(idleId), { timeout: 30_000 }).toBe(true)
    await expect(history).toHaveCount(0, { timeout: 30_000 })

    // The grey node reopens from its menu, which also offers taking it off the map.
    await closeIdle()
    await expect(history).toHaveCount(1, { timeout: 30_000 })
    await history.click({ button: 'right' })
    await expect(action('open-tab')).toContainText('Reopen')
    await expect(action('remove-from-map')).toBeEnabled()
    await screenshot('menu-closed-node')
    await action('open-tab').click()
    await expect.poll(() => hasTab(idleId), { timeout: 30_000 }).toBe(true)
    await page.evaluate(() => window.__store!.getState().openProjectMapPage())
    await expect(history).toHaveCount(0, { timeout: 30_000 })

    // Removing a grey node nobody points at drops it for good.
    await closeIdle()
    await expect(history).toHaveCount(1, { timeout: 30_000 })
    await history.click({ button: 'right' })
    await action('remove-from-map').click()
    await expect(history).toHaveCount(0)
    await page.evaluate(
      (id) => window.__store!.getState().closeUnifiedTab(id),
      structuredAgentSessionTabId(idleId)
    )
    await page.evaluate(() => window.__store!.getState().openProjectMapPage())
    await expect(history).toHaveCount(0)

    // Hiding takes a node off the map; the canvas menu counts and restores it.
    await busyNode.click({ button: 'right' })
    await action('hide').click()
    await expect(busyNode).toHaveCount(0)
    const viewport = map.locator('.project-map-viewport')
    const box = (await viewport.boundingBox())!
    await viewport.click({ button: 'right', position: { x: box.width - 12, y: box.height - 12 } })
    await expect(action('show-hidden')).toContainText('Show hidden (1)')
    await screenshot('menu-show-hidden')
    await action('show-hidden').click()
    await expect(busyNode).toBeVisible()
    await busyNode.click({ button: 'right' })
    await action('hide').click()
    await expect(busyNode).toHaveCount(0)
    // The newest toast is in front; older ones behind it are still collapsing.
    await toast.first().getByRole('button', { name: 'Undo' }).click()
    await expect(busyNode).toBeVisible()

    // A running chat asks first: cancelling keeps it, confirming closes it.
    const dialog = page.getByRole('dialog')
    await busyNode.click({ button: 'right' })
    await action('close').click()
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('still running')
    await screenshot('confirm-running')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toHaveCount(0)
    expect(await hasTab(busyId)).toBe(true)
    await busyNode.click({ button: 'right' })
    await action('close').click()
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await expect.poll(() => hasTab(busyId), { timeout: 30_000 }).toBe(false)
    await expect(history).toHaveCount(1, { timeout: 30_000 })
  } finally {
    await stopCapture()
  }
})
