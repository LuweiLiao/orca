// Completed tab and composer actions return keyboard input to the chat draft.

import type { Locator, Page } from '@stablyai/playwright-test'
import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { splitOrchestrationReferences } from '../../src/shared/native-chat-orchestration-reference'
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
    await expect(chip).toContainText('编译')
    await expect(chip).toContainText(/2 个 Claude|2 Claude agent\(s\)/)
    await expect(composer).toContainText(
      /请处理：(?:2 个 Claude|2 Claude agent\(s\)).*编译.*，然后检查结果/
    )
    await expect(composer).toBeFocused()
    await composer.screenshot({ path: testInfo.outputPath('orchestration-inserted.png') })
    await chip.click()
    const editPicker = page.getByRole('dialog')
    await expect(editPicker.getByRole('textbox', { name: /Claude (Task|负责事项)/ })).toHaveValue(
      '编译'
    )
    await editPicker.getByRole('textbox', { name: /Claude (Task|负责事项)/ }).fill('编译并检查')
    await editPicker.screenshot({ path: testInfo.outputPath('orchestration-edit.png') })
    await expect(
      editPicker.getByRole('spinbutton', { name: /Claude (Agent count|智能体数量)/ })
    ).toHaveValue('2')
    await editPicker.getByRole('spinbutton', { name: /Claude (Agent count|智能体数量)/ }).fill('3')
    await editPicker.getByText('Codex', { exact: true }).locator('..').getByRole('checkbox').check()
    await editPicker.getByRole('button', { name: /^(Update orchestration|更新编排)$/ }).click()
    await expect(composer.locator('[data-native-chat-orchestration="codex"]')).toBeVisible()
    await expect(composer).toContainText(/(?:3 个 Codex|3 Codex agent\(s\)).*编译并检查/)
    await expect(composer.locator('[data-native-chat-orchestration="claude"]')).toHaveCount(0)
    await expect(composer).toBeFocused()
    const remove = composer.getByRole('button', {
      name: /^(Remove agent selection|移除智能体选择)$/
    })
    await expect(remove).toBeVisible()
    await remove.click()
    await expect(composer.locator('[data-native-chat-orchestration]')).toHaveCount(0)
    await composer.screenshot({ path: testInfo.outputPath('orchestration-removed.png') })
  })

  test.describe('orchestration effort and sent pills', () => {
    test.use({ orcaAppExtraEnv: { ORCA_E2E_STUB_EFFORT_CATALOG: '1' } })

    test('preserves model, effort and task through send and reload', async ({
      orcaPage: page,
      claudeStub
    }, testInfo) => {
      const { composer, send, reply } = await openChat(page, claudeStub.command)
      await page.getByRole('button', { name: /^(Orchestration agents|编排智能体)$/ }).click()
      const picker = page.getByRole('dialog')
      await picker.getByText('Claude', { exact: true }).locator('..').getByRole('checkbox').check()
      const task =
        'Review parser [edge cases], preserve C:\\project and validate the complete assignment'
      await picker.getByRole('textbox', { name: /Claude (Task|负责事项)/ }).fill(task)
      await picker.getByRole('combobox', { name: 'Claude Model' }).click()
      await page.getByRole('option', { name: 'Opus', exact: true }).click()
      await picker.getByRole('combobox', { name: 'Claude Effort' }).click()
      await page.getByRole('option', { name: 'High', exact: true }).click()
      await picker.screenshot({ path: testInfo.outputPath('effort-picker.png') })
      await picker.getByRole('button', { name: /^(Add to message|加入消息)$/ }).click()
      const draftPill = composer.locator('[data-native-chat-orchestration="claude"]')
      await expect(draftPill).toContainText('effort: high')
      await expect(draftPill).toContainText(task)
      await draftPill.click()
      await expect(picker.getByRole('textbox', { name: /Claude (Task|负责事项)/ })).toHaveValue(
        task
      )
      await expect(picker.getByRole('combobox', { name: 'Claude Effort' })).toContainText('High')
      await picker.getByRole('button', { name: /^(Update orchestration|更新编排)$/ }).click()
      await send.click()
      await expect(reply).toBeVisible({ timeout: 30_000 })
      await expect(composer.locator('[data-native-chat-orchestration]')).toHaveCount(0)
      const sentPill = page.locator('span[data-native-chat-orchestration="claude"]')
      await expect(sentPill).toHaveCount(1)
      await expect(sentPill).toContainText(task)
      await expect(sentPill).toContainText('effort: high')
      const promptFrameSchema = z.object({
        prompt: z.object({
          content: z.array(z.object({ type: z.literal('text'), text: z.string() }))
        })
      })
      const deliveredAssignments = readFileSync(claudeStub.launchLog, 'utf8')
        .trim()
        .split('\n')
        .flatMap((line) => {
          const frame = promptFrameSchema.safeParse(JSON.parse(line))
          return frame.success
            ? frame.data.prompt.content.flatMap(({ text }) => splitOrchestrationReferences(text))
            : []
        })
      expect(deliveredAssignments).toContainEqual(
        expect.objectContaining({
          agent: 'claude',
          count: 1,
          model: { id: 'opus', label: 'Opus' },
          effort: 'high',
          task
        })
      )
      await page.reload()
      await expect(sentPill).toBeVisible({ timeout: 30_000 })
      await expect(sentPill).toContainText(task)
      await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click()
      await page.getByRole('button', { name: 'Toggle right sidebar', exact: true }).click()
      for (const theme of ['light', 'dark'] as const) {
        await page.evaluate(async (theme) => {
          await window.__store?.getState().updateSettings({ theme })
        }, theme)
        for (const width of [1280, 640]) {
          await page.setViewportSize({ width, height: 800 })
          await expect(sentPill).toBeVisible()
          const layout = await sentPill.evaluate((element) => ({
            fits: element.scrollWidth <= element.clientWidth + 1,
            border: getComputedStyle(element).borderTopWidth
          }))
          expect(layout.fits).toBe(true)
          expect(Number.parseFloat(layout.border)).toBeGreaterThan(0)
          await page.screenshot({ path: testInfo.outputPath(`sent-${theme}-${width}.png`) })
        }
      }
    })
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
