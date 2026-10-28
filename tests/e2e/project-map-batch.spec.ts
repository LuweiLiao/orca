import { mkdirSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { expect } from './helpers/orca-app'
import { SUPPORTED, createChatOnHost, test } from './helpers/structured-claude-stub'
import { buildFakeAgentCommandOverride } from './helpers/fake-agent-command-override'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { startHiddenRendererFrameCapture } from './helpers/hidden-renderer-frame-capture'
import { RuntimeClient } from '../../src/cli/runtime-client'
import { orchestrationReferenceToken } from '../../src/shared/native-chat-orchestration-reference'
import {
  structuredAgentSessionPaneKey,
  structuredAgentSessionTabId
} from '../../src/shared/structured-agent-session-projection'

test.use({ orcaAppExtraEnv: { ORCA_E2E_STUB_EFFORT_CATALOG: '1' } })

const paneKeyOf = (sessionId: string): string =>
  structuredAgentSessionPaneKey(structuredAgentSessionTabId(sessionId), sessionId)

function sessionClient(userDataDir: string, sessionId: string): RuntimeClient {
  const previousCaller = process.env.ORCA_AGENT_SESSION_ID
  process.env.ORCA_AGENT_SESSION_ID = sessionId
  try {
    return new RuntimeClient(userDataDir, 30_000, null, null)
  } finally {
    if (previousCaller === undefined) {
      delete process.env.ORCA_AGENT_SESSION_ID
    } else {
      process.env.ORCA_AGENT_SESSION_ID = previousCaller
    }
  }
}

async function sendInTab(page: Page, sessionId: string, text: string): Promise<void> {
  const tab = page.locator(
    `[data-testid="sortable-tab"][data-tab-id="${structuredAgentSessionTabId(sessionId)}"]`
  )
  await expect(tab).toBeVisible({ timeout: 30_000 })
  await tab.click()
  const chat = page.locator('[data-native-chat-root="true"]')
  await chat.getByRole('textbox').fill(text)
  await chat.getByRole('button', { name: 'Send', exact: true }).click()
}

test('selects several map nodes, then hides, closes and stops them together, summarizing failures', async ({
  orcaPage: page,
  electronApp,
  claudeStub
}, testInfo) => {
  test.skip(!SUPPORTED, 'the Claude stub wrapper is POSIX-only')
  test.setTimeout(480_000)
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

    // A coordinator with one worker that finished and was released.
    const coordinator = await createChatOnHost(page, worktreeId)
    await sendInTab(page, coordinator, 'placeholder')
    const chat = page.locator('[data-native-chat-root="true"]')
    await expect(chat.getByText('Stub reply.', { exact: true })).toBeVisible()
    const composer = chat.getByRole('textbox')
    await composer.fill('Coordinate\n')
    await composer.press('End')
    const card = orchestrationReferenceToken(
      {
        agent: 'claude',
        label: 'Claude',
        count: 1,
        task: 'Implement exports.',
        model: { id: 'sonnet', label: 'sonnet' },
        effort: 'medium'
      },
      'Exports'
    )
    await composer.evaluate((element, text) => {
      const clipboardData = new DataTransfer()
      clipboardData.setData('text/plain', text)
      element.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true })
      )
    }, card)
    await chat.getByRole('button', { name: 'Send', exact: true }).click()
    const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
    const client = sessionClient(userDataDir, coordinator)
    const from = `orca_session_id:${coordinator}`
    const run = await client.call<{ run: { id: string } }>('orchestration.runCreate', {
      objective: 'Exports',
      from
    })
    const started = await client.call<{ dispatchId: string; taskId: string }>(
      'orchestration.workerStart',
      {
        from,
        run: run.result.run.id,
        spec: 'Implement exports.',
        agent: 'claude',
        model: 'sonnet',
        effort: 'medium',
        timeoutMs: 60_000,
        worktree: 'current',
        displayName: 'Exports'
      }
    )
    const dispatch = await client.call<{
      dispatch: { assignee_orca_session_id: string; assignee_handle: string }
    }>('orchestration.dispatchShow', { task: started.result.taskId })
    const workerSession = dispatch.result.dispatch.assignee_orca_session_id
    await sessionClient(userDataDir, workerSession).call('orchestration.send', {
      from: dispatch.result.dispatch.assignee_handle,
      to: `run:${run.result.run.id}`,
      subject: 'Implemented',
      type: 'worker_done',
      payload: JSON.stringify({
        taskId: started.result.taskId,
        dispatchId: started.result.dispatchId,
        outcome: 'succeeded'
      })
    })
    await client.call('orchestration.workerRelease', { dispatch: started.result.dispatchId })

    const idleId = await createChatOnHost(page, worktreeId)
    await sendInTab(page, idleId, 'Plan the batch work')
    await expect(chat.getByText('Stub reply.', { exact: true })).toBeVisible()
    const busyA = await createChatOnHost(page, worktreeId)
    await sendInTab(page, busyA, 'slow work that keeps running')
    const busyB = await createChatOnHost(page, worktreeId)
    await sendInTab(page, busyB, 'slow work that keeps running')
    const busyC = await createChatOnHost(page, worktreeId)
    await sendInTab(page, busyC, 'slow work that keeps running')
    const closedId = await createChatOnHost(page, worktreeId)
    await sendInTab(page, closedId, 'Plan the batch work')
    await expect(chat.getByText('Stub reply.', { exact: true })).toBeVisible()

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
    const bar = map.locator('[data-project-map-batch]')
    const batchAction = (id: string) => bar.locator(`[data-project-map-batch-action="${id}"]`)
    const menu = page.locator('[data-slot="context-menu-content"]')
    const action = (id: string) => menu.locator(`[data-project-map-action="${id}"]`)
    const toast = page.locator('[data-sonner-toast]')
    const dialog = page.getByRole('dialog')
    for (const id of [coordinator, idleId, busyA, busyB, busyC]) {
      await expect(node(id)).toBeVisible({ timeout: 30_000 })
    }
    await expect(node(workerSession)).toBeVisible()
    // Closed from the map, the chat stays as a grey history node.
    await node(closedId).click({ button: 'right' })
    await action('close').click()
    await expect(history).toHaveCount(1, { timeout: 30_000 })
    await expect(node(busyA)).toContainText('Working', { timeout: 30_000 })
    await expect(node(busyB)).toContainText('Working')
    await expect(node(busyC)).toContainText('Working')

    const artifacts = path.join(process.cwd(), 'test-results', 'project-map-batch')
    mkdirSync(artifacts, { recursive: true })
    const screenshot = async (name: string): Promise<void> => {
      const file = path.join(artifacts, `${name}.png`)
      await page.screenshot({ path: file, animations: 'disabled' })
      await testInfo.attach(name, { path: file, contentType: 'image/png' })
    }
    const addToSelection = async (sessionId: string): Promise<void> => {
      await node(sessionId).click({ modifiers: ['Shift'] })
    }

    // One picked node is no batch; the second brings the bar up with the count.
    await addToSelection(idleId)
    await expect(bar).toHaveCount(0)
    await addToSelection(busyA)
    await expect(bar).toContainText('2 selected')
    await expect(node(idleId)).toHaveAttribute('data-merge-picked', 'true')
    await screenshot('selected')

    // Hiding takes both off the map as one undo.
    await batchAction('hide').click()
    await expect(node(idleId)).toHaveCount(0)
    await expect(node(busyA)).toHaveCount(0)
    await expect(bar).toHaveCount(0)
    await expect(toast.first()).toContainText('Hid 2 conversations')
    await toast.first().getByRole('button', { name: 'Undo' }).click()
    await expect(node(idleId)).toBeVisible({ timeout: 30_000 })
    await expect(node(busyA)).toBeVisible()

    // A released worker and a closed chat join a selection too; Stop has nothing to do for them.
    await addToSelection(idleId)
    await addToSelection(workerSession)
    await history.first().click({ modifiers: ['Shift'] })
    await expect(bar).toContainText('3 selected')
    await expect(batchAction('stop')).toBeDisabled()
    await batchAction('hide').click()
    await expect(history).toHaveCount(0)
    await toast.first().getByRole('button', { name: 'Undo' }).click()
    await expect(history).toHaveCount(1, { timeout: 30_000 })
    await expect(node(workerSession)).toBeVisible()

    // Stop is offered only to a running chat; a click asks first, cancelling changes nothing.
    await node(idleId).click({ button: 'right' })
    await expect(action('stop')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await node(busyA).click({ button: 'right' })
    await expect(action('stop')).toBeEnabled()
    await action('stop').click()
    await expect(dialog).toContainText('Stop')
    await screenshot('confirm-stop')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(node(busyA)).toContainText('Working')
    await node(busyA).click({ button: 'right' })
    await action('stop').click()
    await dialog.getByRole('button', { name: 'Stop', exact: true }).click()
    await expect(node(busyA)).not.toContainText('Working', { timeout: 60_000 })
    await expect(toast.first()).toContainText('Stopped')

    // Closing a selection that holds a running chat asks once for all of them.
    await addToSelection(idleId)
    await addToSelection(busyB)
    await batchAction('close').click()
    await expect(dialog).toContainText('Close 2 conversations?')
    await expect(dialog).toContainText('1 still running')
    await screenshot('confirm-close')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    expect(await hasTab(busyB)).toBe(true)
    expect(await hasTab(idleId)).toBe(true)
    await batchAction('close').click()
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await expect.poll(() => hasTab(busyB), { timeout: 30_000 }).toBe(false)
    expect(await hasTab(idleId)).toBe(false)
    await expect(history).toHaveCount(3, { timeout: 30_000 })
    await toast.first().getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => hasTab(busyB), { timeout: 30_000 }).toBe(true)
    await expect.poll(() => hasTab(idleId), { timeout: 30_000 }).toBe(true)
    await expect(history).toHaveCount(1, { timeout: 30_000 })

    // A stop that one chat refuses ends in a single summary naming the count and the reason.
    // Reopening a closed chat does not resume its work: give it more, so it is running again.
    await page.evaluate(() => window.__store!.getState().setActiveView('terminal'))
    await sendInTab(page, busyB, 'slow work that keeps running')
    await page.evaluate(() => window.__store!.getState().openProjectMapPage())
    await expect(node(busyC)).toContainText('Working', { timeout: 30_000 })
    const stuckKey = paneKeyOf(busyB)
    await expect(node(busyB)).toContainText('Working', { timeout: 30_000 })
    await addToSelection(busyC)
    await addToSelection(busyB)
    await batchAction('stop').click()
    await expect(dialog).toContainText('Stop 2 conversations?')
    // The host re-publishes this map, so the refusal is set in the same task as the click that
    // reads it.
    await page.evaluate((paneKey) => {
      const store = window.__store!
      store.getState().setRuntimeAgentOrchestrationByPaneKey({
        ...store.getState().runtimeAgentOrchestrationByPaneKey,
        [paneKey]: {
          taskId: 'task_missing',
          dispatchId: 'ctx_missing',
          dispatchStatus: 'dispatched'
        }
      })
      const confirm = [...document.querySelectorAll('[role="dialog"] button')].find(
        (button) => button.textContent?.trim() === 'Stop'
      )
      if (confirm instanceof HTMLElement) {
        confirm.click()
      }
    }, stuckKey)
    await expect(toast.first()).toContainText('1 succeeded, 1 failed', { timeout: 60_000 })
    await screenshot('partial-failure')
    await expect(node(busyC)).not.toContainText('Working', { timeout: 60_000 })
  } finally {
    await stopCapture()
  }
})
