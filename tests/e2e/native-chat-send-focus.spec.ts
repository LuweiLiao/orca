// Completed tab and composer actions return keyboard input to the chat draft.

import type { Locator, Page } from '@stablyai/playwright-test'
import { expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { buildFakeAgentCommandOverride } from './helpers/fake-agent-command-override'
import { SUPPORTED, createChatOnHost, test } from './helpers/structured-claude-stub'

function focusIsIn(composer: Locator): Promise<boolean> {
  return composer.evaluate((element) => element.contains(element.ownerDocument.activeElement))
}

async function openChat(page: Page, claudeCommand: string) {
  await waitForSessionReady(page)
  const worktreeId = await waitForActiveWorktree(page)
  await page.evaluate(async (command) => {
    await window.__store?.getState().updateSettings({
      experimentalNativeChat: true,
      defaultTuiAgent: 'claude',
      agentCmdOverrides: { claude: command }
    })
  }, buildFakeAgentCommandOverride(claudeCommand))
  const sessionId = await createChatOnHost(page, worktreeId)
  const readTabId = () =>
    page.evaluate(
      ({ worktreeId, sessionId }) =>
        window.__store
          ?.getState()
          .unifiedTabsByWorktree[worktreeId]?.find((tab) => tab.entityId === sessionId)?.id,
      { worktreeId, sessionId }
    )
  await expect.poll(readTabId, { timeout: 30_000 }).toBeTruthy()
  const tab = page.locator(`[data-testid="sortable-tab"][data-tab-id="${await readTabId()}"]`)
  await tab.click()
  const chat = page.locator('[data-native-chat-root="true"]')
  const composer = chat.getByRole('textbox')
  await composer.click()
  return {
    tab,
    composer,
    send: chat.getByRole('button', { name: 'Send', exact: true }),
    stop: chat.getByRole('button', { name: 'Stop the agent' }),
    reply: chat.getByText('Stub reply.')
  }
}

test.describe('native chat composer focus', () => {
  test.skip(!SUPPORTED, 'the Claude stub wrapper is POSIX-only')

  test('adds a selected orchestration agent to the message draft', async ({
    orcaPage: page,
    claudeStub
  }, testInfo) => {
    const { composer } = await openChat(page, claudeStub.command)
    await composer.fill('请处理：，然后检查结果')
    await composer.evaluate((element) => {
      const text = element.querySelector('p')?.firstChild
      if (!text) {
        throw new Error('Missing prompt text')
      }
      const selection = window.getSelection()
      selection?.setBaseAndExtent(text, 4, text, 4)
    })
    await page.evaluate(() => {
      window.__store?.setState({ detectedAgentIds: ['claude', 'codex'] })
    })
    await page.getByRole('button', { name: /^(Orchestration agents|编排智能体)$/ }).click()
    const picker = page.getByRole('dialog')
    await expect(picker.getByText('Claude', { exact: true })).toBeVisible()
    await picker.getByText('Claude', { exact: true }).locator('..').getByRole('checkbox').check()
    await picker.getByRole('textbox', { name: /Claude (Task|负责事项)/ }).fill('编译')
    await picker.getByRole('spinbutton', { name: /Claude (Agent count|智能体数量)/ }).fill('2')
    const bounds = await picker.boundingBox()
    expect(bounds?.width).toBeGreaterThan(0)
    expect(bounds?.height).toBeGreaterThan(0)
    await picker.screenshot({ path: testInfo.outputPath('orchestration-picker.png') })
    await picker.getByRole('button', { name: /^(Add to message|加入消息)$/ }).click()
    const chip = composer.locator('[data-native-chat-orchestration="claude"]')
    await expect(chip).toBeVisible()
    await expect(chip).not.toContainText('编译')
    await expect(chip).toContainText(/2 个 Claude|2 Claude agent\(s\)/)
    await expect(composer).toContainText(
      /请处理：(?:编译用 2 个 Claude|编译: 2 Claude agent\(s\)).*，然后检查结果/
    )
    await expect(composer).toBeFocused()
    await composer.screenshot({ path: testInfo.outputPath('orchestration-inserted.png') })
    await chip.click()
    const editPicker = page.getByRole('dialog')
    await expect(editPicker.getByRole('textbox', { name: /Claude (Task|负责事项)/ })).toHaveCount(0)
    await editPicker.screenshot({ path: testInfo.outputPath('orchestration-edit.png') })
    await expect(
      editPicker.getByRole('spinbutton', { name: /Claude (Agent count|智能体数量)/ })
    ).toHaveValue('2')
    await editPicker.getByRole('spinbutton', { name: /Claude (Agent count|智能体数量)/ }).fill('3')
    await editPicker.getByText('Codex', { exact: true }).locator('..').getByRole('checkbox').check()
    await editPicker.getByRole('button', { name: /^(Update orchestration|更新编排)$/ }).click()
    await expect(composer.locator('[data-native-chat-orchestration="codex"]')).toBeVisible()
    await expect(composer).toContainText(/编译用 3 个 Codex|编译: 3 Codex agent\(s\)/)
    await expect(composer).not.toContainText(/编译用 2 个 Claude|编译: 2 Claude agent\(s\)/)
    await expect(composer).toBeFocused()
    const remove = composer.getByRole('button', {
      name: /^(Remove agent selection|移除智能体选择)$/
    })
    await expect(remove).toBeVisible()
    await remove.click()
    await expect(composer.locator('[data-native-chat-orchestration]')).toHaveCount(0)
    await composer.screenshot({ path: testInfo.outputPath('orchestration-removed.png') })
  })

  test('keyboard tab rename returns input to the native chat composer', async ({
    orcaPage: page,
    claudeStub
  }) => {
    const { tab, composer } = await openChat(page, claudeStub.command)
    await tab.dblclick()
    const rename = tab.locator('[data-tab-rename-input="true"]')
    await expect(rename).toBeFocused()
    await rename.fill('')
    await rename.pressSequentially('Renamed chat', { delay: 60 })
    await page.keyboard.press('Enter')
    await expect(rename).toHaveCount(0)
    await expect(tab).toHaveAttribute('data-tab-title', 'Renamed chat')
    await expect.poll(() => focusIsIn(composer)).toBe(true)
    await page.keyboard.type('Draft after rename')
    await expect(composer).toContainText('Draft after rename')
  })

  test('when Send disables at the end of the turn', async ({ orcaPage: page, claudeStub }) => {
    const { composer, send, stop, reply } = await openChat(page, claudeStub.command)
    await page.keyboard.type('hello')
    await send.click()
    await expect(reply).toBeVisible({ timeout: 30_000 })
    await expect(stop).toHaveCount(0)
    await expect.poll(() => focusIsIn(composer)).toBe(true)
  })

  test('when Stop disables while the stop is in flight', async ({ orcaPage: page, claudeStub }) => {
    const { composer, send, stop } = await openChat(page, claudeStub.command)
    // The stub runs a prompt containing "slow" until it is interrupted.
    await page.keyboard.type('slow')
    await send.click()
    await stop.click()
    await expect(stop).toHaveCount(0, { timeout: 30_000 })
    await expect.poll(() => focusIsIn(composer)).toBe(true)
  })
})
