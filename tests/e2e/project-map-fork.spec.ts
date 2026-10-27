import { mkdirSync, readFileSync } from 'node:fs'
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

// The stub records each prompt it is sent, which is how the hand-off's content is checked.
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

test('forks a chat from its map node, then forks again from a grandparent fork point', async ({
  orcaPage: page,
  claudeStub
}, testInfo) => {
  test.skip(!SUPPORTED, 'the Claude stub wrapper is POSIX-only')
  test.setTimeout(240_000)
  await waitForSessionReady(page)
  const stopCapture = await startHiddenRendererFrameCapture(page)
  try {
    await page.setViewportSize({ width: 1440, height: 960 })
    const worktreeId = await waitForActiveWorktree(page)
    await page.evaluate(async (command) => {
      await window.__store!.getState().updateSettings({
        // Why: the copy asserted below is English; the host locale may not be.
        uiLanguage: 'en',
        experimentalNativeChat: true,
        defaultTuiAgent: 'claude',
        tabAutoGenerateTitle: false,
        agentCmdOverrides: { claude: command }
      })
    }, buildFakeAgentCommandOverride(claudeStub.command))
    const parent = await createChatOnHost(page, worktreeId)
    const parentTab = page.locator(
      `[data-testid="sortable-tab"][data-tab-id="${structuredAgentSessionTabId(parent)}"]`
    )
    await expect(parentTab).toBeVisible({ timeout: 30_000 })
    await parentTab.click()
    const chat = page.locator('[data-native-chat-root="true"]')
    await chat.getByRole('textbox').fill('Plan the project map forks')
    await chat.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(chat.getByText('Stub reply.', { exact: true })).toBeVisible()

    await page.evaluate(() => window.__store!.getState().openProjectMapPage())
    const map = page.locator('.project-map')
    const node = (id: string) => map.locator(`[data-project-map-node="${id}"]`)
    const parentNode = node(paneKeyOf(parent))
    await expect(parentNode).toBeVisible({ timeout: 30_000 })

    const artifacts = path.join(process.cwd(), 'test-results', 'project-map-fork')
    mkdirSync(artifacts, { recursive: true })
    const screenshot = async (name: string): Promise<void> => {
      const file = path.join(artifacts, `${name}.png`)
      await page.screenshot({ path: file, animations: 'disabled' })
      await testInfo.attach(name, { path: file, contentType: 'image/png' })
    }

    // Hovering shows the + handle; dragging it draws a dashed wire to a pending node.
    const handle = map.locator('[data-project-map-fork-handle]')
    const ghost = map.locator('[data-project-map-fork-draft]')
    const draftWire = map.locator('.project-map-wire[data-kind="fork-draft"]')
    const panel = map.locator('[data-project-map-fork-panel]')
    await parentNode.hover()
    await expect(handle).toHaveCount(1)
    const from = await handle.boundingBox()
    const drop = { x: (from?.x ?? 0) + 160, y: (from?.y ?? 0) + 260 }
    await page.mouse.move((from?.x ?? 0) + 11, (from?.y ?? 0) + 11)
    await page.mouse.down()
    await page.mouse.move(drop.x, drop.y, { steps: 8 })
    await expect(ghost).toHaveAttribute('data-project-map-fork-draft', 'dragging')
    await expect(draftWire).toHaveCount(1)
    await screenshot('fork-drag')
    // Escape drops the drag without creating anything.
    await page.keyboard.press('Escape')
    await page.mouse.up()
    await expect(ghost).toHaveCount(0)
    await expect(panel).toHaveCount(0)
    // Released on the canvas, the node stays there, wired, and the panel opens beside it.
    await parentNode.hover()
    await page.mouse.move((from?.x ?? 0) + 11, (from?.y ?? 0) + 11)
    await page.mouse.down()
    await page.mouse.move(drop.x, drop.y, { steps: 8 })
    await page.mouse.up()
    await expect(ghost).toHaveAttribute('data-project-map-fork-draft', 'placed')
    await expect(panel).toBeVisible()
    await expect(draftWire).toHaveCount(1)
    await screenshot('fork-drag-placed')
    await panel.getByRole('button', { name: 'Cancel' }).click()
    await expect(ghost).toHaveCount(0)

    // Selecting the node shows its + handle; the panel offers only the chat itself as a source.
    await parentNode.click()
    await handle.click()
    await expect(panel).toBeVisible()
    // The footer stays on screen however low the node sits.
    await expect(panel.getByRole('button', { name: 'Create child chat' })).toBeInViewport({
      ratio: 1
    })
    await expect(panel.getByRole('radio')).toHaveCount(1)
    await panel.getByRole('textbox').fill('CHILD-ONE: try ELK layered layout')
    await screenshot('fork-panel')
    await panel.getByRole('button', { name: 'Create child chat' }).click()
    await expect(panel).toHaveCount(0)
    // The new child is selected once it appears, with its chat window open beside it.
    const childWindow = map.locator('[data-project-map-window]')
    await expect(childWindow.getByText('Stub reply.', { exact: true }).first()).toBeVisible({
      timeout: 30_000
    })
    const wires = map.locator('.project-map-wire[data-kind="handoff"]')
    await expect(wires).toHaveCount(1)
    await expect(map.getByText(/Handed off from .* · 2 messages/)).toBeVisible()
    // Named for what the person asked, not for the transferred conversation it opens with.
    await expect(
      map.getByRole('button', { name: 'CHILD-ONE: try ELK layered layout', exact: true })
    ).toBeVisible()
    // The child was given the parent's conversation, then the person's instruction.
    await expect
      .poll(() => sentPrompts(claudeStub.launchLog).find((prompt) => prompt.includes('CHILD-ONE')))
      .toMatch(/Plan the project map forks[\s\S]*Stub reply\.[\s\S]*CHILD-ONE: try ELK/)
    await screenshot('fork-child')

    // From the child, go back to its parent where it forked, beside the first child.
    const childKey = await childWindow.evaluate(() => {
      const selected = document.querySelector('[data-project-map-node][data-selected="true"]')
      return selected?.getAttribute('data-project-map-node') ?? null
    })
    expect(childKey).not.toBe(paneKeyOf(parent))
    await map.locator('[data-project-map-fork-handle]').click()
    await expect(panel.getByRole('radio')).toHaveCount(2)
    await panel.getByText('Where it forked the next chat').click()
    await panel.getByRole('textbox').fill('CHILD-TWO: try force-directed layout')
    await panel.getByRole('button', { name: 'Create child chat' }).click()
    await expect(wires).toHaveCount(2)
    await expect(parentNode).toContainText('2 forks')
    await expect
      .poll(() => sentPrompts(claudeStub.launchLog).find((prompt) => prompt.includes('CHILD-TWO')))
      .toBeTruthy()
    const second = sentPrompts(claudeStub.launchLog).find((prompt) => prompt.includes('CHILD-TWO'))
    // The sibling starts from the parent as it was then, not from the first child's conversation.
    expect(second).not.toContain('CHILD-ONE')
    // Every fork edge leaves the parent: both children inherit from it.
    const fromParent = await map
      .locator('.project-map-wire[data-kind="handoff"]')
      .evaluateAll((paths) => paths.map((element) => element.getAttribute('d')?.split(' C')[0]))
    expect(new Set(fromParent).size).toBe(1)
    const viewport = map.locator('.project-map-viewport')
    const viewportBox = await viewport.boundingBox()
    await viewport.click({ position: { x: (viewportBox?.width ?? 200) - 12, y: 6 } })
    await screenshot('fork-tree')
  } finally {
    await stopCapture()
  }
})
