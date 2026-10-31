import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { expect } from './helpers/orca-app'
import { SUPPORTED, createChatOnHost, test } from './helpers/structured-claude-stub'
import { buildFakeAgentCommandOverride } from './helpers/fake-agent-command-override'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { startHiddenRendererFrameCapture } from './helpers/hidden-renderer-frame-capture'
import { closeProjectMapWindows } from './helpers/project-map-windows'
import {
  structuredAgentSessionPaneKey,
  structuredAgentSessionTabId
} from '../../src/shared/structured-agent-session-projection'

test.use({ orcaAppExtraEnv: { ORCA_E2E_STUB_EFFORT_CATALOG: '1' } })

const paneKeyOf = (sessionId: string): string =>
  structuredAgentSessionPaneKey(structuredAgentSessionTabId(sessionId), sessionId)

test('right-clicks, renames, searches and opens map nodes, closed history chats included', async ({
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
    await page.evaluate(async (command) => {
      await window.__store!.getState().updateSettings({
        uiLanguage: 'en',
        experimentalNativeChat: true,
        defaultTuiAgent: 'claude',
        tabAutoGenerateTitle: false,
        agentCmdOverrides: { claude: command }
      })
    }, buildFakeAgentCommandOverride(claudeStub.command))
    const parent = await createChatOnHost(page, worktreeId)
    const parentTabId = structuredAgentSessionTabId(parent)
    const parentTab = page.locator(`[data-testid="sortable-tab"][data-tab-id="${parentTabId}"]`)
    await expect(parentTab).toBeVisible({ timeout: 30_000 })
    await parentTab.click()
    const chat = page.locator('[data-native-chat-root="true"]')
    await chat.getByRole('textbox').fill('Plan the node actions')
    await chat.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(chat.getByText('Stub reply.', { exact: true })).toBeVisible()

    await page.evaluate(() => window.__store!.getState().openProjectMapPage())
    const map = page.locator('.project-map')
    const node = (id: string) => map.locator(`[data-project-map-node="${id}"]`)
    const parentNode = node(paneKeyOf(parent))
    await expect(parentNode).toBeVisible({ timeout: 30_000 })
    const chatWindow = map.locator('[data-project-map-chat-window]')
    const menu = page.locator('[data-slot="context-menu-content"]')
    const action = (id: string) => menu.locator(`[data-project-map-action="${id}"]`)

    const artifacts = path.join(process.cwd(), 'test-results', 'project-map-actions')
    mkdirSync(artifacts, { recursive: true })
    const screenshot = async (name: string): Promise<void> => {
      const file = path.join(artifacts, `${name}.png`)
      await page.screenshot({ path: file, animations: 'disabled' })
      await testInfo.attach(name, { path: file, contentType: 'image/png' })
    }

    // An open chat: every item, the unavailable one saying why, and no window opened by the click.
    await parentNode.click({ button: 'right' })
    await expect(menu).toBeVisible()
    for (const id of ['open-tab', 'reference', 'new-child', 'rename', 'mark-unread']) {
      await expect(action(id)).toBeEnabled()
    }
    await expect(action('show-terminal')).toHaveAttribute('data-disabled', '')
    await expect(action('show-terminal')).toContainText('No terminal behind this conversation')
    await expect(chatWindow).toHaveCount(0)
    await screenshot('menu-chat')

    // Marking unread puts the unread marker on the node; marking read takes it off.
    const unreadBadge = parentNode.locator('.project-map-node-badge[data-tone="unseen"]')
    await action('mark-unread').click()
    await expect(unreadBadge).toHaveCount(1)
    await parentNode.click({ button: 'right' })
    await action('mark-read').click()
    await expect(unreadBadge).toHaveCount(0)

    // New child conversation: the menu item opens the same panel as the + handle.
    await parentNode.click({ button: 'right' })
    await action('new-child').click()
    const panel = map.locator('[data-project-map-fork-panel]')
    await expect(panel).toBeVisible()
    await panel.getByRole('textbox').fill('CHILD-ONE: try the menu')
    await panel.locator('[data-project-map-handoff-mode-option="messages"]').check()
    await panel.getByRole('button', { name: 'Create child chat' }).click()
    const childNode = map.getByRole('button', { name: 'CHILD-ONE: try the menu', exact: true })
    await expect(childNode).toBeVisible({ timeout: 30_000 })
    await expect(chatWindow.getByText('Stub reply.', { exact: true }).first()).toBeVisible({
      timeout: 30_000
    })

    // Closing the child's tab leaves it on the map as a grey history node, joined by the fork.
    const childTabId = await page.evaluate(
      (keep) =>
        Object.values(window.__store!.getState().unifiedTabsByWorktree)
          .flat()
          .find((tab) => tab.contentType === 'agent-session' && tab.id !== keep)?.id ?? null,
      parentTabId
    )
    expect(childTabId).not.toBeNull()
    await page.evaluate((id) => window.__store!.getState().closeUnifiedTab(id), childTabId!)
    const history = map.locator('[data-project-map-node][data-history="true"]')
    await expect(history).toHaveCount(1, { timeout: 30_000 })
    // Closing its tab closes the chat, and its window with it.
    await expect(chatWindow).toHaveCount(0)

    // A closed chat can be reopened or referenced; forking and renaming say what to do first.
    await history.click({ button: 'right' })
    await expect(action('open-tab')).toBeEnabled()
    await expect(action('reference')).toBeEnabled()
    await expect(action('new-child')).toHaveAttribute('data-disabled', '')
    await expect(action('rename')).toHaveAttribute('data-disabled', '')
    await expect(action('rename')).toContainText('Open it in a tab to rename it')
    await expect(action('mark-read')).toHaveCount(0)
    await expect(action('mark-unread')).toHaveCount(0)
    await screenshot('menu-history')
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)

    // Rename: Enter commits once, Escape cancels, and the field sits over the node.
    const rename = map.locator('[data-project-map-rename] input')
    await parentNode.click({ button: 'right' })
    await action('rename').click()
    await expect(rename).toBeFocused()
    await rename.fill('Dropped edit')
    await page.keyboard.press('Escape')
    await expect(rename).toHaveCount(0)
    await expect(parentNode).toHaveAttribute('aria-label', 'Plan the node actions')
    await parentNode.click({ button: 'right' })
    await action('rename').click()
    await expect(rename).toBeFocused()
    await screenshot('rename')
    await rename.fill('Node actions lead')
    await page.keyboard.press('Enter')
    await expect(rename).toHaveCount(0)
    await expect(parentNode).toHaveAttribute('aria-label', 'Node actions lead')

    // A workspace node opens the sidebar's workspace menu at the pointer, at any zoom.
    const workspaceNode = node(worktreeId)
    await map.getByRole('button', { name: 'Zoom out' }).click()
    await workspaceNode.click({ button: 'right', position: { x: 40, y: 20 } })
    const workspaceMenu = page.getByRole('menu')
    await expect(workspaceMenu).toBeVisible()
    const nodeBox = (await workspaceNode.boundingBox())!
    const menuBox = (await workspaceMenu.boundingBox())!
    expect(Math.abs(menuBox.x - (nodeBox.x + 40))).toBeLessThan(60)
    expect(Math.abs(menuBox.y - (nodeBox.y + 20))).toBeLessThan(60)
    await screenshot('menu-workspace')
    await page.keyboard.press('Escape')
    await expect(workspaceMenu).toHaveCount(0)

    // The empty canvas offers fit and search.
    const viewport = map.locator('.project-map-viewport')
    const viewportBox = (await viewport.boundingBox())!
    await viewport.click({
      button: 'right',
      position: { x: viewportBox.width - 12, y: viewportBox.height - 12 }
    })
    await expect(action('fit')).toBeVisible()
    await expect(action('search')).toBeVisible()
    await screenshot('menu-canvas')
    await action('search').click()
    const search = map.locator('[data-project-map-search]')
    await expect(search).toBeVisible()
    await expect(search.getByRole('combobox')).toBeFocused()

    // Search finds the closed chat by its title, centers it and flags it.
    await search.getByRole('combobox').fill('child-one')
    const hit = search.locator('[data-project-map-search-kind="title"]')
    await expect(hit).toHaveCount(1)
    await expect(hit).toContainText('Closed')
    await page.keyboard.press('Enter')
    await expect(search).toHaveCount(0)
    await expect(history).toHaveAttribute('data-selected', 'true')
    await expect(map.locator('[data-project-map-match]')).toHaveCount(1)
    await screenshot('search-located')
    const located = (await history.boundingBox())!
    const area = (await viewport.boundingBox())!
    expect(Math.abs(located.x + located.width / 2 - (area.x + area.width / 2))).toBeLessThan(30)
    expect(Math.abs(located.y + located.height / 2 - (area.y + area.height / 2))).toBeLessThan(30)
    await expect(map.locator('[data-project-map-match]')).toHaveCount(0, { timeout: 10_000 })

    // Ctrl+F opens the search from the canvas; inside a chat window it stays with the chat.
    await expect(chatWindow).toBeVisible()
    await chatWindow.getByRole('textbox').focus()
    await page.keyboard.press('Control+f')
    await expect(search).toHaveCount(0)
    await closeProjectMapWindows(map)
    await viewport.click({ position: { x: 8, y: 8 } })
    await page.keyboard.press('Control+f')
    await expect(search).toBeVisible()

    // What chats said comes from the session index: a hit on the map leads to its node, one off
    // the map is only counted. The index is stubbed; its own search has its own specs.
    await electronApp.evaluate(
      ({ ipcMain }, sessions) => {
        const hit = (sessionId: string, snippet: string) => ({
          agent: 'claude',
          executionHostId: 'local',
          sessionId: `provider-${sessionId}`,
          title: 'transcript',
          cwd: null,
          branch: null,
          updatedAt: null,
          messageCount: 2,
          score: 1,
          source: { presence: 'missing' },
          evidence: { snippet, role: 'assistant', timestamp: null },
          structuredSession: { sessionId, workspaceId: 'w' }
        })
        ipcMain.removeHandler('aiVault:searchSessions')
        ipcMain.handle('aiVault:searchSessions', () => ({
          kind: 'results',
          hits: [
            hit(sessions.onMap, 'the lanes need a [[gutter]] between them'),
            hit(sessions.offMap, 'a [[gutter]] elsewhere')
          ],
          page: { cursor: null, hasMore: false },
          generation: 1,
          truncated: { candidates: false, snippets: 0, query: false, freshness: false },
          durationMs: 1
        }))
      },
      { onMap: parent, offMap: 'claude_00000000_0000_4000_8000_000000000000' }
    )
    await search.getByRole('combobox').fill('gutter')
    const said = search.locator('[data-project-map-search-kind="message"]')
    await expect(said).toHaveCount(1)
    await expect(said).toContainText('gutter between them')
    await expect(search.locator('mark')).toHaveText('gutter')
    await expect(search.locator('[data-project-map-search-status]')).toContainText(
      '1 more chat matches off this map'
    )
    await screenshot('search-messages')
    await said.click()
    await expect(search).toHaveCount(0)
    await expect(parentNode).toHaveAttribute('data-selected', 'true')
    await viewport.click({ position: { x: 8, y: 8 } })
    await page.keyboard.press('Control+f')
    await expect(search).toBeVisible()
    await electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('aiVault:searchSessions')
      ipcMain.handle('aiVault:searchSessions', () => ({ kind: 'unavailable', reason: 'disabled' }))
    })
    await search.getByRole('combobox').fill('no such conversation')
    await expect(search.locator('[data-project-map-search-status]')).toContainText(
      'Message search is off'
    )
    await expect(search).toContainText('Nothing on this map matches')
    await page.keyboard.press('Escape')
    await expect(search).toHaveCount(0)
    const searchButton = map.locator('header').getByRole('button', { name: 'Search the map' })
    await searchButton.click()
    await expect(search).toBeVisible()
    await searchButton.click()
    await expect(search).toHaveCount(0)

    // Double-clicking a closed chat reopens its tab; double-clicking an open one shows its tab.
    await closeProjectMapWindows(map)
    await history.dblclick()
    await expect
      .poll(() =>
        page.evaluate(
          (id) =>
            Object.values(window.__store!.getState().unifiedTabsByWorktree).some((tabs) =>
              tabs.some((tab) => tab.id === id)
            ),
          childTabId!
        )
      )
      .toBe(true)
    await page.evaluate(() => window.__store!.getState().openProjectMapPage())
    await expect(parentNode).toBeVisible({ timeout: 30_000 })
    await closeProjectMapWindows(map)
    await parentNode.dblclick()
    await expect(map).toHaveCount(0)
    await expect(parentTab).toBeVisible()
  } finally {
    await stopCapture()
  }
})
