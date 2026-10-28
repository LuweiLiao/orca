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

test('walks the map with the keyboard, reorders rows and tidies them', async ({
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
    const parent = await createChatOnHost(page, worktreeId)
    const parentTabId = structuredAgentSessionTabId(parent)
    const parentTab = page.locator(`[data-testid="sortable-tab"][data-tab-id="${parentTabId}"]`)
    await expect(parentTab).toBeVisible({ timeout: 30_000 })
    await parentTab.click()
    const chat = page.locator('[data-native-chat-root="true"]')
    await chat.getByRole('textbox').fill('Plan the keyboard map')
    await chat.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(chat.getByText('Stub reply.', { exact: true })).toBeVisible()

    const openMap = async (): Promise<void> => {
      await page.evaluate(() => window.__store!.getState().openProjectMapPage())
    }
    await openMap()
    const map = page.locator('.project-map')
    const viewport = map.locator('.project-map-viewport')
    const node = (id: string) => map.locator(`[data-project-map-node="${id}"]`)
    const parentNode = node(paneKeyOf(parent))
    await expect(parentNode).toBeVisible({ timeout: 30_000 })
    const chatWindow = map.locator('[data-project-map-chat-window]')
    const menu = page.locator('[data-slot="context-menu-content"]')
    const action = (id: string) => menu.locator(`[data-project-map-action="${id}"]`)
    const cursor = map.locator('[data-project-map-cursor]')

    const artifacts = path.join(process.cwd(), 'test-results', 'project-map-keyboard')
    mkdirSync(artifacts, { recursive: true })
    const screenshot = async (name: string): Promise<void> => {
      const file = path.join(artifacts, `${name}.png`)
      await page.screenshot({ path: file, animations: 'disabled' })
      await testInfo.attach(name, { path: file, contentType: 'image/png' })
    }

    const newChild = async (title: string): Promise<string> => {
      await parentNode.click({ button: 'right' })
      await action('new-child').click()
      const panel = map.locator('[data-project-map-fork-panel]')
      await expect(panel).toBeVisible()
      await panel.getByRole('textbox').fill(title)
      await panel.getByRole('button', { name: 'Create child chat' }).click()
      const child = map.getByRole('button', { name: title, exact: true })
      await expect(child).toBeVisible({ timeout: 30_000 })
      await expect(chatWindow.getByText('Stub reply.', { exact: true }).first()).toBeVisible({
        timeout: 30_000
      })
      return (await child.getAttribute('data-project-map-node'))!
    }

    // Two children of one chat share a column; the first is then closed, leaving a grey node.
    await newChild('CHILD-FIRST: closed')
    const firstTabId = await page.evaluate(
      (keep) =>
        Object.values(window.__store!.getState().unifiedTabsByWorktree)
          .flat()
          .find((tab) => tab.contentType === 'agent-session' && tab.id !== keep)?.id ?? null,
      parentTabId
    )
    expect(firstTabId).not.toBeNull()
    await page.evaluate((id) => window.__store!.getState().closeUnifiedTab(id), firstTabId!)
    const history = map.locator('[data-project-map-node][data-history="true"]')
    await expect(history).toHaveCount(1, { timeout: 30_000 })
    const closedKey = (await history.getAttribute('data-project-map-node'))!
    const secondKey = await newChild('CHILD-SECOND: open')
    const closed = node(closedKey)
    const open = node(secondKey)
    const yOf = async (locator: typeof closed): Promise<number> => (await locator.boundingBox())!.y
    // Which of the two sits higher is the layout's call; the rest reads from what it chose.
    const openOnTop = (await yOf(open)) < (await yOf(closed))
    const [firstKey, first, second] = openOnTop
      ? [secondKey, open, closed]
      : [closedKey, closed, open]
    expect(await yOf(first)).toBeLessThan(await yOf(second))

    // Arrows pick the nearest node, grey ones included, and open nothing.
    await viewport.click({ position: { x: 6, y: 6 } })
    await expect(chatWindow).toHaveCount(0)
    await viewport.focus()
    await page.keyboard.press('ArrowRight')
    await expect(cursor).toHaveAttribute('data-project-map-cursor', worktreeId)
    await page.keyboard.press('ArrowRight')
    await expect(cursor).toHaveAttribute('data-project-map-cursor', paneKeyOf(parent))
    await page.keyboard.press('ArrowRight')
    await expect(cursor).toHaveAttribute('data-project-map-cursor', firstKey)
    await page.keyboard.press('ArrowDown')
    await expect(cursor).toHaveAttribute(
      'data-project-map-cursor',
      openOnTop ? closedKey : secondKey
    )
    await page.keyboard.press('ArrowLeft')
    await expect(cursor).toHaveAttribute('data-project-map-cursor', paneKeyOf(parent))
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowDown')
    await expect(cursor).toHaveAttribute(
      'data-project-map-cursor',
      openOnTop ? closedKey : secondKey
    )
    await expect(chatWindow).toHaveCount(0)
    await screenshot('cursor')

    // Zoom keys scale the view.
    const zoom = map.locator('header').getByText(/^\d+%$/)
    const before = await zoom.textContent()
    await page.keyboard.press('-')
    await expect(zoom).not.toHaveText(before!)
    await page.keyboard.press('+')
    await expect(zoom).toHaveText(before!)

    const goTo = async (key: string): Promise<void> => {
      const now = await cursor.getAttribute('data-project-map-cursor')
      if (now !== key) {
        await page.keyboard.press(key === firstKey ? 'ArrowUp' : 'ArrowDown')
      }
      await expect(cursor).toHaveAttribute('data-project-map-cursor', key)
    }
    // A tooltip left open by the pointer would take an Escape first.
    await page.mouse.move(700, 880)
    await expect(page.locator('[data-slot="tooltip-content"]')).toHaveCount(0)

    // Enter opens the window of the cursor's node; walking on leaves that window where it is.
    await goTo(secondKey)
    await page.keyboard.press('Enter')
    await expect(chatWindow).toBeVisible()
    await expect(open).toHaveAttribute('data-selected', 'true')
    await viewport.focus()
    await goTo(closedKey)
    await expect(open).toHaveAttribute('data-selected', 'true')

    // Escape drops the selection and the cursor.
    await viewport.focus()
    await page.keyboard.press('Escape')
    await expect(cursor).toHaveCount(0)
    await expect(chatWindow).toHaveCount(0)

    // Space joins a merge and leaves it, opening nothing; a grey chat cannot be merged.
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await goTo(secondKey)
    await page.keyboard.press('Space')
    await expect(open).toHaveAttribute('data-merge-picked', 'true')
    await expect(chatWindow).toHaveCount(0)
    await page.keyboard.press('Space')
    await expect(open).not.toHaveAttribute('data-merge-picked', 'true')

    // F2 puts the rename field over the cursor's node; Escape cancels it. A grey chat has no tab.
    const rename = map.locator('[data-project-map-rename] input')
    await goTo(closedKey)
    await page.keyboard.press('F2')
    await expect(rename).toHaveCount(0)
    await goTo(secondKey)
    await page.keyboard.press('F2')
    await expect(rename).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(rename).toHaveCount(0)
    await viewport.focus()

    // Keys typed into a field are the field's own.
    await page.keyboard.press('Enter')
    await expect(chatWindow).toBeVisible()
    await chatWindow.getByRole('textbox').fill('Keys ')
    await chatWindow.getByRole('textbox').press('ArrowLeft')
    await page.keyboard.type('stay')
    await expect(chatWindow.getByRole('textbox')).toContainText('stay')
    await expect(cursor).toHaveAttribute('data-project-map-cursor', secondKey)
    await expect(open).toHaveAttribute('data-selected', 'true')
    await chatWindow.getByRole('textbox').press('Control+a')
    await chatWindow.getByRole('textbox').press('Backspace')
    await viewport.focus()
    await page.keyboard.press('Escape')
    await expect(chatWindow).toHaveCount(0)

    // Alt moves the open chat past its neighbour; nowhere further, and the order is kept.
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await goTo(secondKey)
    await page.keyboard.press(openOnTop ? 'Alt+ArrowDown' : 'Alt+ArrowUp')
    await expect.poll(async () => (await yOf(open)) < (await yOf(closed))).toBe(!openOnTop)
    await screenshot('rows-swapped')
    await page.keyboard.press(openOnTop ? 'Alt+ArrowDown' : 'Alt+ArrowUp')
    await expect.poll(async () => (await yOf(open)) < (await yOf(closed))).toBe(!openOnTop)

    // Shift+Enter shows the chat in its tab; coming back to the map finds the rows as left.
    await page.keyboard.press('Shift+Enter')
    await expect(map).toHaveCount(0)
    await openMap()
    await expect(open).toBeVisible({ timeout: 30_000 })
    expect((await yOf(open)) < (await yOf(closed))).toBe(!openOnTop)

    // The menu offers the same moves, greyed where a chat is already at the edge.
    // The open chat now sits at the end opposite to where it started.
    const stuck = openOnTop ? 'move-down' : 'move-up'
    const free = openOnTop ? 'move-up' : 'move-down'
    await open.click({ button: 'right' })
    await expect(action(stuck)).toHaveAttribute('data-disabled', '')
    await expect(action(free)).toBeEnabled()
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    // The grey chat sits at the other end, so it can move toward the open one and back.
    await closed.click({ button: 'right' })
    await action(stuck).click()
    await expect.poll(async () => (await yOf(open)) < (await yOf(closed))).toBe(openOnTop)
    await closed.click({ button: 'right' })
    await action(free).click()
    await expect.poll(async () => (await yOf(open)) < (await yOf(closed))).toBe(!openOnTop)

    // Shift+F10 opens the menu of the node under the cursor.
    await viewport.click({ position: { x: 6, y: 6 } })
    await viewport.focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Shift+F10')
    await expect(action('rename')).toBeVisible()
    await expect(action('move-up')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)

    // Tidy layout forgets the hand-set order and puts the chats back in flow order.
    const viewportBox = (await viewport.boundingBox())!
    await viewport.click({
      button: 'right',
      position: { x: viewportBox.width - 12, y: viewportBox.height - 12 }
    })
    await action('tidy').click()
    await expect.poll(async () => (await yOf(open)) < (await yOf(closed))).toBe(openOnTop)
    await screenshot('tidied')
    await viewport.click({
      button: 'right',
      position: { x: viewportBox.width - 12, y: viewportBox.height - 12 }
    })
    await expect(action('tidy')).toHaveAttribute('data-disabled', '')
  } finally {
    await stopCapture()
  }
})
