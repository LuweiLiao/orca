import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { expect } from './helpers/orca-app'
import { SUPPORTED, createChatOnHost, test } from './helpers/structured-claude-stub'
import { buildFakeAgentCommandOverride } from './helpers/fake-agent-command-override'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { startHiddenRendererFrameCapture } from './helpers/hidden-renderer-frame-capture'
import { closeProjectMapWindows } from './helpers/project-map-windows'
import { RuntimeClient } from '../../src/cli/runtime-client'
import { orchestrationReferenceToken } from '../../src/shared/native-chat-orchestration-reference'
import {
  structuredAgentSessionPaneKey,
  structuredAgentSessionTabId
} from '../../src/shared/structured-agent-session-projection'

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

const paneKeyOf = (sessionId: string): string =>
  structuredAgentSessionPaneKey(structuredAgentSessionTabId(sessionId), sessionId)

const TASKS = ['CSV export', 'Cursor pagination', 'Rate limits', 'Audit log']

test('stacks a busy coordinator’s workers, lists them beside it, and drags a node in as a reference', async ({
  orcaPage: page,
  electronApp,
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
    const parentTab = page.locator(
      `[data-testid="sortable-tab"][data-tab-id="${structuredAgentSessionTabId(parent)}"]`
    )
    await expect(parentTab).toBeVisible({ timeout: 30_000 })
    await parentTab.click()
    // Only assignment cards the user sends authorize the coordinator to start workers.
    const cards = TASKS.map((task) =>
      orchestrationReferenceToken(
        {
          agent: 'claude',
          label: 'Claude',
          count: 1,
          task: `Implement ${task}.`,
          model: { id: 'sonnet', label: 'sonnet' },
          effort: 'medium'
        },
        task
      )
    ).join('\n')
    const chat = page.locator('[data-native-chat-root="true"]')
    const composer = chat.getByRole('textbox')
    await composer.fill('Coordinate the API work\n')
    await composer.press('End')
    await composer.evaluate((element, text) => {
      const clipboardData = new DataTransfer()
      clipboardData.setData('text/plain', text)
      element.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true })
      )
    }, cards)
    await expect(composer.locator('[data-native-chat-orchestration="claude"]')).toHaveCount(4)
    await chat.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(chat.getByText('Stub reply.', { exact: true })).toBeVisible()

    const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
    const client = sessionClient(userDataDir, parent)
    const from = `orca_session_id:${parent}`
    const run = await client.call<{ run: { id: string } }>('orchestration.runCreate', {
      objective: 'API work',
      from
    })
    const workers: { dispatchId: string; taskId: string; sessionId: string; handle: string }[] = []
    for (const task of TASKS) {
      const started = await client.call<{ dispatchId: string; taskId: string; state: string }>(
        'orchestration.workerStart',
        {
          from,
          run: run.result.run.id,
          spec: `Implement ${task}.`,
          agent: 'claude',
          model: 'sonnet',
          effort: 'medium',
          timeoutMs: 60_000,
          worktree: 'current',
          displayName: task
        }
      )
      expect(started.result.state).toBe('ready')
      const dispatch = await client.call<{
        dispatch: { assignee_orca_session_id: string; assignee_handle: string }
      }>('orchestration.dispatchShow', { task: started.result.taskId })
      workers.push({
        ...started.result,
        sessionId: dispatch.result.dispatch.assignee_orca_session_id,
        handle: dispatch.result.dispatch.assignee_handle
      })
    }
    // A finished, released worker must stay in the stack and keep its history readable.
    const finished = workers[0]!
    await sessionClient(userDataDir, finished.sessionId).call('orchestration.send', {
      from: finished.handle,
      to: `run:${run.result.run.id}`,
      subject: 'Implemented',
      type: 'worker_done',
      payload: JSON.stringify({
        taskId: finished.taskId,
        dispatchId: finished.dispatchId,
        outcome: 'succeeded'
      })
    })
    await client.call('orchestration.workerRelease', { dispatch: finished.dispatchId })

    await page.evaluate(() => window.__store!.getState().openProjectMapPage())
    const map = page.locator('.project-map')
    const node = (id: string) => map.locator(`[data-project-map-node="${id}"]`)
    const stack = node(`project-map-group:${paneKeyOf(parent)}`)
    await expect(stack).toBeVisible({ timeout: 30_000 })
    await expect(stack).toContainText('4 delegated chats')
    for (const { sessionId } of workers) {
      await expect(node(paneKeyOf(sessionId))).toHaveCount(0)
    }
    await expect(map.locator('.project-map-wire[data-kind="delegate"]')).toHaveCount(1)
    await expect(node(paneKeyOf(parent))).toContainText('Delegates 4')

    const artifacts = path.join(process.cwd(), 'test-results', 'project-map-stack')
    mkdirSync(artifacts, { recursive: true })
    const screenshot = async (name: string): Promise<void> => {
      const file = path.join(artifacts, `${name}.png`)
      await page.screenshot({ path: file, animations: 'disabled' })
      await testInfo.attach(name, { path: file, contentType: 'image/png' })
    }
    await screenshot('stacked')

    await stack.click()
    const tray = map.locator('[data-project-map-tray]')
    await expect(tray.locator('[data-project-map-tray-row]')).toHaveCount(4)
    await screenshot('tray')
    await tray.getByRole('textbox').fill('pagination')
    await expect(tray.locator('[data-project-map-tray-row]')).toHaveCount(1)
    await tray.getByRole('textbox').fill('')

    // Opening the released worker shows its whole chat beside the stack; the list stays open.
    await tray.locator(`[data-project-map-tray-row="${paneKeyOf(finished.sessionId)}"]`).click()
    const chatWindow = map.locator('[data-project-map-chat-window]')
    await expect(tray).toHaveCount(1)
    await expect(chatWindow.getByText('You are a dispatched worker.').first()).toBeVisible({
      timeout: 30_000
    })
    const windowComposer = chatWindow.getByRole('textbox')
    await expect(windowComposer).toBeVisible()
    await expect(stack).toHaveAttribute('data-selected', 'true')

    // The coordinator's node drops into that composer as a conversation reference; the list,
    // which stays open beside it, is closed first so it does not cover the node.
    // The chat opened last is on top; pressing the list's header brings the list forward.
    const zOf = (locator: typeof tray): Promise<number> =>
      locator.evaluate((element) => Number(getComputedStyle(element).zIndex))
    expect(await zOf(chatWindow)).toBeGreaterThan(await zOf(tray))
    await tray.locator('header').click({ position: { x: 8, y: 8 } })
    await expect.poll(() => zOf(tray)).toBeGreaterThan(await zOf(chatWindow))
    await tray.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(tray).toHaveCount(0)
    await expect(windowComposer).toBeVisible()
    await node(paneKeyOf(parent)).dragTo(windowComposer)
    const pill = windowComposer.locator('[data-native-chat-conversation-reference]')
    await expect(pill).toHaveCount(1)
    // A snapshot: it names how far into the coordinator's chat it reads.
    await expect(pill).toContainText(/#\d+/)
    // Switched to follow the chat, the pill says so and the sent wire reads as live.
    await pill.click()
    const preview = page.getByRole('dialog', { name: /Coordinate the API work/ })
    await preview.getByRole('button', { name: 'Follow the chat as it goes on' }).click()
    await expect(pill).toContainText('live')
    await expect(pill).not.toContainText(/#\d+/)
    await screenshot('reference-dropped')
    // Sent, the reference becomes a wire from its source; to a stacked chat it meets the stack.
    await windowComposer.pressSequentially('Use this plan.')
    // Enter, not the Send button: the star prompt can cover the window's corner.
    await windowComposer.press('Enter')
    const referenceWire = map.locator('.project-map-wire[data-kind="reference"]')
    await expect(referenceWire).toHaveCount(1, { timeout: 30_000 })
    await expect(referenceWire).toHaveAttribute('data-live', 'true')

    // Showing the fleet on the map draws each worker again.
    await node(paneKeyOf(parent)).click()
    await chatWindow.getByRole('button', { name: 'Show them on the map' }).click()
    for (const { sessionId } of workers) {
      await expect(node(paneKeyOf(sessionId))).toBeVisible()
    }
    await expect(stack).toHaveCount(0)
    await expect(map.locator('.project-map-wire[data-kind="delegate"]')).toHaveCount(4)
    // Shown on the map, the referencing worker takes the wire and counts the reference.
    await expect(referenceWire).toHaveCount(1)
    await expect(
      node(paneKeyOf(finished.sessionId)).locator('[data-project-map-reference-count="1"]')
    ).toBeVisible()
    await screenshot('expanded')

    // A node dropped on another opens that chat with the reference in its message box.
    const [, second, third] = workers
    await closeProjectMapWindows(map)
    await node(paneKeyOf(second!.sessionId)).dragTo(node(paneKeyOf(third!.sessionId)))
    await expect(node(paneKeyOf(third!.sessionId))).toHaveAttribute('data-selected', 'true')
    const thirdComposer = map.locator('[data-project-map-chat-window]').getByRole('textbox')
    await expect(thirdComposer.locator('[data-native-chat-conversation-reference]')).toHaveCount(
      1,
      { timeout: 15_000 }
    )
    await screenshot('node-dropped-on-node')

    // A new child chat can read other chats besides the one it inherits.
    await map
      .locator('[data-project-map-chat-window]')
      .getByRole('button', { name: 'Close', exact: true })
      .click()
    await node(paneKeyOf(parent)).click()
    await map.locator('[data-project-map-fork-handle]').click()
    const panel = map.locator('[data-project-map-fork-panel]')
    await expect(panel).toBeVisible()
    await node(paneKeyOf(second!.sessionId)).dragTo(panel)
    await node(paneKeyOf(third!.sessionId)).dragTo(panel)
    await expect(panel.locator('[data-native-chat-conversation-reference]')).toHaveCount(2)
    await panel.getByRole('textbox').fill('MERGE: compare the two workers')
    await screenshot('fork-with-references')
    await panel.getByRole('button', { name: 'Create child chat' }).click()
    await expect(panel).toHaveCount(0, { timeout: 60_000 })
    // Named for the typed text, and drawn with a wire from each chat it was told to read.
    await expect(
      map.getByRole('button', { name: 'MERGE: compare the two workers', exact: true })
    ).toBeVisible({ timeout: 30_000 })
    await expect(map.locator('.project-map-wire[data-kind="reference"]')).toHaveCount(3, {
      timeout: 30_000
    })
    await expect(node(paneKeyOf(parent))).toContainText('Delegates 4 · 1 handoff')
    await screenshot('fork-references-drawn')
    expect(
      await electronApp.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some((window) => window.isVisible())
      )
    ).toBe(false)
  } finally {
    await stopCapture()
  }
})
