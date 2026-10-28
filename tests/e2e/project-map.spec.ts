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

test('maps derived worktrees and delegated chats, and opens a chat beside its node', async ({
  orcaPage: page,
  electronApp,
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
    const placements = [
      { displayName: 'CSV export', worktree: 'current' },
      {
        displayName: 'Cursor pagination',
        worktree: 'new-child',
        name: 'pm-pagination',
        setup: 'skip'
      }
    ]
    // Only an assignment card the user sends authorizes the coordinator to start workers.
    const cards = placements
      .map(({ displayName }) =>
        orchestrationReferenceToken(
          {
            agent: 'claude',
            label: 'Claude',
            count: 1,
            task: `Implement ${displayName}.`,
            model: { id: 'sonnet', label: 'sonnet' },
            effort: 'medium'
          },
          displayName
        )
      )
      .join('\n')
    const chat = page.locator('[data-native-chat-root="true"]')
    const composer = chat.getByRole('textbox')
    await composer.fill('Coordinate the export work\n')
    await composer.press('End')
    await composer.evaluate((element, text) => {
      const clipboardData = new DataTransfer()
      clipboardData.setData('text/plain', text)
      element.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true })
      )
    }, cards)
    await expect(composer.locator('[data-native-chat-orchestration="claude"]')).toHaveCount(2)
    await chat.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(chat.getByText('Stub reply.', { exact: true })).toBeVisible()

    const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
    const client = sessionClient(userDataDir, parent)
    const from = `orca_session_id:${parent}`
    const run = await client.call<{ run: { id: string } }>('orchestration.runCreate', {
      objective: 'Export work',
      from
    })
    const workers: { dispatchId: string; taskId: string; sessionId: string; handle: string }[] = []
    for (const placement of placements) {
      const started = await client.call<{ dispatchId: string; taskId: string; state: string }>(
        'orchestration.workerStart',
        {
          from,
          run: run.result.run.id,
          spec: `Implement ${placement.displayName}.`,
          agent: 'claude',
          model: 'sonnet',
          effort: 'medium',
          timeoutMs: 60_000,
          ...placement
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

    await page.evaluate(() => window.__store!.getState().openProjectMapPage())
    const map = page.locator('.project-map')
    await expect(map.getByRole('heading', { name: 'Project Map' })).toBeVisible()
    const node = (id: string) => map.locator(`[data-project-map-node="${id}"]`)
    await expect(node(paneKeyOf(parent))).toBeVisible({ timeout: 30_000 })
    for (const { sessionId } of workers) {
      await expect(node(paneKeyOf(sessionId))).toBeVisible({ timeout: 30_000 })
    }
    await expect(map.locator('.project-map-wire[data-kind="delegate"]')).toHaveCount(2)
    await expect(map.locator('.project-map-wire[data-kind="derive"]')).toHaveCount(1)
    // Every relation flows rightward through the gutters, never back across a column.
    const backwardWires = await map.locator('.project-map-wire').evaluateAll(
      (paths) =>
        paths.filter((element) => {
          const numbers = (element.getAttribute('d') ?? '').match(/-?\d+(\.\d+)?/g) ?? []
          return Number(numbers[6]) <= Number(numbers[0])
        }).length
    )
    expect(backwardWires).toBe(0)

    const artifacts = path.join(process.cwd(), 'test-results', 'project-map')
    mkdirSync(artifacts, { recursive: true })
    const screenshot = async (name: string): Promise<void> => {
      const file = path.join(artifacts, `${name}.png`)
      await page.screenshot({ path: file, animations: 'disabled' })
      await testInfo.attach(name, { path: file, contentType: 'image/png' })
    }

    const derived = workers[1]
    if (!derived) {
      throw new Error('the worker placed in a new child worktree must have started')
    }
    const worker = node(paneKeyOf(derived.sessionId))
    await worker.click()
    const chatWindow = map.locator('[data-project-map-window]')
    await expect(chatWindow).toBeVisible()
    await expect(chatWindow.getByText('Stub reply.', { exact: true }).first()).toBeVisible({
      timeout: 30_000
    })
    await expect(chatWindow.getByRole('textbox')).toBeVisible()
    const windowBox = await chatWindow.boundingBox()
    const workerBox = await worker.boundingBox()
    if (!windowBox || !workerBox) {
      throw new Error('the chat window and its node must both be laid out')
    }
    // The window opens beside its node, never on top of it.
    const overlapsNode =
      windowBox.x < workerBox.x + workerBox.width &&
      workerBox.x < windowBox.x + windowBox.width &&
      windowBox.y < workerBox.y + workerBox.height &&
      workerBox.y < windowBox.y + windowBox.height
    expect(overlapsNode).toBe(false)
    for (const theme of ['dark', 'light'] as const) {
      await page.evaluate((t) => window.__store!.getState().updateSettings({ theme: t }), theme)
      await screenshot(`agent-window-${theme}`)
    }

    // The wheel scrolls the chat under the pointer; only the bare canvas pans.
    const viewport = map.locator('.project-map-viewport')
    const content = viewport.locator('[data-project-map-content]')
    const panOf = (): Promise<string> => content.evaluate((element) => element.style.transform)
    const panBefore = await panOf()
    await page.mouse.move(windowBox.x + windowBox.width / 2, windowBox.y + windowBox.height / 2)
    await page.mouse.wheel(0, 240)
    await expect.poll(panOf).toBe(panBefore)
    const viewportBox = await viewport.boundingBox()
    await page.mouse.move((viewportBox?.x ?? 0) + 8, (viewportBox?.y ?? 0) + 8)
    await page.mouse.wheel(0, 120)
    await expect.poll(panOf).not.toBe(panBefore)
    await map.getByRole('button', { name: 'Fit to view' }).click()

    // An empty canvas press drops the selection but leaves the window for its own close button.
    await viewport.click({ position: { x: (viewportBox?.width ?? 200) - 12, y: 6 } })
    await expect(worker).not.toHaveAttribute('data-selected', 'true')
    await expect(chatWindow).toHaveCount(1)
    await closeProjectMapWindows(map)

    // Releasing a finished worker retires its tab; the map still draws it and reads its history.
    await sessionClient(userDataDir, derived.sessionId).call('orchestration.send', {
      from: derived.handle,
      to: `run:${run.result.run.id}`,
      subject: 'Implemented',
      type: 'worker_done',
      payload: JSON.stringify({
        taskId: derived.taskId,
        dispatchId: derived.dispatchId,
        outcome: 'succeeded'
      })
    })
    const released = await client.call<{ state: string }>('orchestration.workerRelease', {
      dispatch: derived.dispatchId
    })
    expect(['released', 'already_released']).toContain(released.result.state)
    await expect
      .poll(() =>
        page.evaluate(
          (tabId) =>
            Object.values(window.__store!.getState().unifiedTabsByWorktree).some((tabs) =>
              tabs.some((tab) => tab.id === tabId)
            ),
          structuredAgentSessionTabId(derived.sessionId)
        )
      )
      .toBe(false)
    await worker.click()
    await expect(chatWindow.getByText('Stub reply.', { exact: true }).first()).toBeVisible({
      timeout: 30_000
    })
    // The summary fallback has no composer, so this proves the full chat rendered.
    await expect(chatWindow.getByRole('textbox')).toBeVisible()
    await screenshot('agent-window-released')

    // The coordinator's worktree holds the parent chat and the worker placed on `current`. Its
    // window opens beside the worker's, which stays open; the last one touched is on top.
    const nodeWindows = map.locator('[data-project-map-node-window]')
    const workerWindow = nodeWindows.filter({ hasNot: page.getByRole('tablist') })
    const workspaceWindow = nodeWindows.filter({ has: page.getByRole('tablist') })
    await node(worktreeId).click()
    await expect(workspaceWindow.getByRole('tab')).toHaveCount(2)
    await expect(nodeWindows).toHaveCount(2)
    const zOf = (locator: typeof chatWindow): Promise<number> =>
      locator.first().evaluate((element) => Number(getComputedStyle(element).zIndex))
    expect(await zOf(workspaceWindow)).toBeGreaterThan(await zOf(workerWindow))
    await screenshot('workspace-window')
    await viewport.click({ position: { x: (viewportBox?.width ?? 200) - 12, y: 6 } })
    await expect(nodeWindows).toHaveCount(2)
    // Each window closes on its own, leaving the other open.
    await workspaceWindow.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(nodeWindows).toHaveCount(1)
    await expect(workerWindow.getByRole('textbox')).toBeVisible()
    // A second click on a node closes the window its first click opened, and a third reopens it.
    await node(worktreeId).click()
    await expect(workspaceWindow).toHaveCount(1)
    await node(worktreeId).click()
    await expect(workspaceWindow).toHaveCount(0)
    await expect(workerWindow).toHaveCount(1)
    await node(worktreeId).click()
    await expect(workspaceWindow).toHaveCount(1)
    await closeProjectMapWindows(map)
    await screenshot('map')
    expect(
      await electronApp.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some((window) => window.isVisible())
      )
    ).toBe(false)
  } finally {
    await stopCapture()
  }
})
