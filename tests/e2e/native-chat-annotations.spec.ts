import { randomUUID } from 'node:crypto'
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActiveTerminalManager } from './helpers/terminal'
import { claudeTranscriptLines } from './helpers/native-chat-transcript-fixture'

const FIRST = 'The controller compensates the measured disturbance.'
const SECOND = 'The observer estimates the remaining disturbance.'

test('conversation annotations preserve quotes, highlight passages and collect editable comments', async ({
  orcaPage,
  electronApp
}, testInfo) => {
  await waitForSessionReady(orcaPage)
  await electronApp.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.setSize(1280, 900)
    }
  })
  await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)
  await waitForActiveTerminalManager(orcaPage, 30_000)
  const descriptor = await waitForActivePaneHookDescriptor(orcaPage)
  const [tabId] = descriptor.paneKey.split(':')
  const sessionId = `e2e-annotations-${randomUUID()}`
  const transcriptPath = join(
    mkdtempSync(join(tmpdir(), 'orca-annotation-transcript-')),
    `${sessionId}.jsonl`
  )
  writeFileSync(
    transcriptPath,
    claudeTranscriptLines({
      sessionId,
      userText: 'Explain the controller and observer.',
      assistantText: `${FIRST}\n\n${SECOND}`
    })
  )
  await orcaPage.evaluate(
    async ({ paneKey, worktreeId, sessionId, transcriptPath, tabId }) => {
      const settings = await window.api.settings.set({
        experimentalNativeChat: true,
        uiLanguage: 'en',
        theme: 'dark'
      })
      const store = window.__store
      if (!store) {
        throw new Error('Store unavailable')
      }
      store.setState({ settings })
      const state = store.getState()
      state.setAgentStatus(
        paneKey,
        { state: 'done', agentType: 'claude', prompt: 'annotation review' },
        'Claude',
        undefined,
        { worktreeId },
        { providerSession: { key: 'session_id', id: sessionId, transcriptPath } }
      )
      const tab = state.unifiedTabsByWorktree[worktreeId]?.find(
        (candidate) => candidate.contentType === 'terminal' && candidate.entityId === tabId
      )
      if (!tab) {
        throw new Error('Terminal unavailable')
      }
      state.toggleTabViewMode(tab.id)
    },
    { ...descriptor, sessionId, transcriptPath, tabId }
  )

  const root = orcaPage.locator('[data-native-chat-root="true"]')
  const first = root.getByText(FIRST, { exact: true })
  const second = root.getByText(SECOND, { exact: true })
  await expect(first).toBeVisible()
  await first.click({ clickCount: 3 })
  await orcaPage.getByRole('button', { name: 'Add annotation', exact: true }).click()
  const tray = root.getByRole('region', { name: 'Annotations', exact: true })
  await tray
    .getByRole('textbox', { name: 'Comment', exact: true })
    .fill('Explain how the measured signal enters the controller.')
  await tray.getByRole('button', { name: 'Save annotation', exact: true }).click()
  await expect(
    tray.getByText('Explain how the measured signal enters the controller.', { exact: true })
  ).toBeVisible()
  await expect
    .poll(() =>
      orcaPage.evaluate(() =>
        [...CSS.highlights.keys()].some((name) => name.startsWith('native-chat-annotation-'))
      )
    )
    .toBe(true)

  await second.click({ clickCount: 3 })
  await second.click({ button: 'right' })
  await orcaPage.getByRole('menuitem', { name: 'Add annotation', exact: true }).click()
  await tray
    .getByRole('textbox', { name: 'Comment', exact: true })
    .fill('State the physical units of the estimate.')
  await tray.getByRole('button', { name: 'Save annotation', exact: true }).click()
  await expect(tray.getByRole('listitem')).toHaveCount(2)
  await tray.getByRole('button', { name: 'Edit annotation', exact: true }).first().click()
  await tray
    .getByRole('textbox', { name: 'Comment', exact: true })
    .fill('Explain the measured signal and its control effect.')
  await tray.getByRole('button', { name: 'Save annotation', exact: true }).click()
  await orcaPage.emulateMedia({ reducedMotion: 'reduce' })
  appendFileSync(
    transcriptPath,
    Array.from({ length: 60 }, (_, index) =>
      claudeTranscriptLines({
        sessionId,
        messageIdPrefix: `${sessionId}-later-${index}`,
        userText: `Later question ${index}`,
        assistantText: `Later answer ${index}. ${'Measured signal and controller response. '.repeat(20)}`
      })
    ).join('')
  )
  const scroller = root.locator('[data-native-chat-scroll]')
  await expect(
    root.locator('[data-native-chat-quote-source]').filter({ hasText: 'Later answer 59.' })
  ).toBeVisible({ timeout: 30_000 })
  await scroller.evaluate((element) => element.scrollTo({ top: element.scrollHeight }))
  const original = root.locator('[data-native-chat-quote-source]').filter({ hasText: FIRST })
  await expect(original).toHaveCount(0)
  await tray.getByRole('button', { name: 'Show original text', exact: true }).first().click()
  await expect(original).toBeVisible()
  await expect
    .poll(async () =>
      original.evaluate((element) => {
        const viewport = element.closest('[data-native-chat-scroll]')?.getBoundingClientRect()
        const bounds = element.getBoundingClientRect()
        return (
          viewport !== undefined && bounds.bottom > viewport.top && bounds.top < viewport.bottom
        )
      })
    )
    .toBe(true)
  await orcaPage.screenshot({
    path: testInfo.outputPath('annotation-original-after-virtualization.png')
  })
  await orcaPage.screenshot({ path: testInfo.outputPath('annotations-desktop.png') })

  await orcaPage.setViewportSize({ width: 720, height: 800 })
  await orcaPage.evaluate(() =>
    window.__store?.setState({ sidebarOpen: false, rightSidebarOpen: false })
  )
  await expect.poll(async () => (await root.boundingBox())?.width ?? 0).toBeGreaterThan(600)
  const bounds = await tray.boundingBox()
  expect(bounds).not.toBeNull()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(721)
  expect(await tray.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await orcaPage.screenshot({ path: testInfo.outputPath('annotations-narrow.png') })
  await tray.getByRole('button', { name: 'Add annotations to message', exact: true }).click()
  await expect(tray).toHaveCount(0)
  await expect(root.getByRole('textbox')).toContainText(
    'Explain the measured signal and its control effect.'
  )
  await expect(root.getByRole('textbox')).toContainText('State the physical units of the estimate.')
  await expect(root.getByRole('textbox')).toContainText(FIRST)
  await expect(root.getByRole('textbox')).toContainText(SECOND)
  expect(
    await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().every((window) => !window.isVisible())
    )
  ).toBe(true)
})

test('Chinese queue search shows why the runtime does not offer follow-up queueing', async ({
  orcaPage
}, testInfo) => {
  await waitForSessionReady(orcaPage)
  await orcaPage.evaluate(async () => {
    const settings = await window.api.settings.set({
      uiLanguage: 'zh-CN',
      experimentalNativeChat: true,
      theme: 'dark'
    })
    const store = window.__store
    if (!store) {
      throw new Error('Store unavailable')
    }
    store.setState({ settings })
    store.getState().openSettingsPage()
    store.getState().setSettingsSearchQuery('将后续消息加入队列')
  })
  await orcaPage.getByRole('button', { name: '聊天', exact: true }).click()
  await expect(orcaPage.getByRole('switch', { name: '切换后续消息队列' })).toBeDisabled()
  await expect(orcaPage.getByText(/此主机不支持.*队列|此主机不支持.*排队/)).toBeVisible()
  await orcaPage.screenshot({ path: testInfo.outputPath('queue-search-chinese.png') })
})
