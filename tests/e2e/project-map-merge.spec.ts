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

const lineageResult = z.object({
  ok: z.literal(true),
  result: z.object({
    entries: z.array(
      z.object({
        childSessionId: z.string(),
        sourceSessionId: z.string(),
        sources: z.array(z.object({ sessionId: z.string() })).optional()
      })
    )
  })
})

test('forks from a picked turn on the timeline, then merges two picked chats into one child', async ({
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
    const replies = chat.getByText('Stub reply.', { exact: true })
    for (const [index, message] of [
      'FIRST-TURN: sketch the lanes',
      'SECOND-TURN: colour the wires'
    ].entries()) {
      await chat.getByRole('textbox').fill(message)
      await chat.getByRole('textbox').press('Enter')
      await expect(replies).toHaveCount(index + 1, { timeout: 30_000 })
    }

    await page.evaluate(() => window.__store!.getState().openProjectMapPage())
    const map = page.locator('.project-map')
    const parentNode = map.locator(`[data-project-map-node="${paneKeyOf(parent)}"]`)
    await expect(parentNode).toBeVisible({ timeout: 30_000 })
    const artifacts = path.join(process.cwd(), 'test-results', 'project-map-merge')
    mkdirSync(artifacts, { recursive: true })
    const screenshot = async (name: string): Promise<void> => {
      const file = path.join(artifacts, `${name}.png`)
      await page.screenshot({ path: file, animations: 'disabled' })
      await testInfo.attach(name, { path: file, contentType: 'image/png' })
    }

    // The first turn's "new child from here" hands over that turn only, not the one after it.
    await parentNode.click()
    const parentWindow = map.locator('[data-project-map-chat-window]')
    await parentWindow.locator('[data-project-map-timeline-toggle]').click()
    const turns = parentWindow.locator('[data-project-map-timeline-turn]')
    await expect(turns).toHaveCount(2)
    await turns.first().hover()
    await turns.first().locator('[data-project-map-timeline-action="fork"]').click()
    const panel = map.locator('[data-project-map-fork-panel]')
    await expect(panel).toBeVisible()
    await expect(panel.getByText('Through turn 1: FIRST-TURN: sketch the lanes')).toBeVisible()
    await panel.getByRole('textbox').fill('FROM-TURN-ONE: try a grid')
    await screenshot('fork-at-turn')
    await panel.getByRole('button', { name: 'Create child chat' }).click()
    await expect(panel).toHaveCount(0)
    await expect
      .poll(() =>
        sentPrompts(claudeStub.launchLog).find((prompt) => prompt.includes('FROM-TURN-ONE'))
      )
      .toBeTruthy()
    const fromTurn = sentPrompts(claudeStub.launchLog).find((prompt) =>
      prompt.includes('FROM-TURN-ONE')
    )!
    expect(fromTurn).toContain('FIRST-TURN: sketch the lanes')
    expect(fromTurn).not.toContain('SECOND-TURN')
    expect(fromTurn).toContain('Messages handed over: 2 of 2')

    // Shift-click both chats, drag the merge handle out, and merge them into one new chat.
    const lineage = async () =>
      lineageResult.parse(
        await page.evaluate(() =>
          window.api.runtime.call({ method: 'agentSession.lineage', params: {} })
        )
      ).result.entries
    const child = (await lineage()).find((entry) => entry.sourceSessionId === parent)!
    const childNode = map.locator(`[data-project-map-node="${paneKeyOf(child.childSessionId)}"]`)
    // The child must have answered before it can be read at its latest turn.
    await expect(childNode).toContainText('Idle', { timeout: 30_000 })
    await map.locator('[data-project-map-window] button[aria-label="Close"]').first().click()
    await parentNode.click({ modifiers: ['Shift'] })
    await childNode.click({ modifiers: ['Shift'] })
    await expect(map.locator('[data-merge-picked="true"]')).toHaveCount(2)
    const handle = map.locator('[data-project-map-merge-handle]')
    await expect(handle).toHaveText('Merge 2 chats')
    const from = (await handle.boundingBox())!
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(from.x + 40, from.y + 220, { steps: 8 })
    // One dashed wire from each picked chat meets the pending node.
    await expect(map.locator('.project-map-wire[data-kind="fork-draft"]')).toHaveCount(2)
    await expect(map.locator('[data-project-map-fork-draft]')).toContainText('Merged from 2 chats')
    await screenshot('merge-drag')
    await page.mouse.up()
    const mergePanel = map.locator('[data-project-map-merge-panel]')
    await expect(mergePanel).toBeVisible()
    await expect(mergePanel.getByRole('radio')).toHaveCount(2)
    await mergePanel.getByRole('textbox').fill('MERGED: compare the two')
    await screenshot('merge-panel')
    await mergePanel.getByRole('button', { name: 'Merge into a new chat' }).click()
    await expect(mergePanel).toHaveCount(0, { timeout: 30_000 })
    await expect
      .poll(() => sentPrompts(claudeStub.launchLog).find((prompt) => prompt.includes('MERGED:')))
      .toBeTruthy()
    const merged = sentPrompts(claudeStub.launchLog).find((prompt) => prompt.includes('MERGED:'))!
    expect(merged).toContain('continues from 2 other Orca conversations, merged')
    expect(merged.indexOf('## Source 1 of 2')).toBeLessThan(merged.indexOf('## Source 2 of 2'))
    // The parent's whole conversation, and the child's own, each in its section.
    expect(merged).toContain('SECOND-TURN: colour the wires')
    expect(merged).toContain('FROM-TURN-ONE: try a grid')
    await expect
      .poll(async () =>
        (await lineage())
          .find((entry) => entry.sources !== undefined)
          ?.sources?.map((source) => source.sessionId)
      )
      .toEqual([parent, child.childSessionId])
    const mergedNode = map.getByRole('button', { name: 'MERGED: compare the two', exact: true })
    await expect(mergedNode).toBeVisible({ timeout: 30_000 })
    await expect(mergedNode).toContainText('Merged from')
    // Its first source is its parent; the other one draws a merge wire into it.
    await expect(map.locator('.project-map-wire[data-kind="merge"]')).toHaveCount(1, {
      timeout: 15_000
    })
    await screenshot('merged')
  } finally {
    await stopCapture()
  }
})
