import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { expect } from './helpers/orca-app'
import { SUPPORTED, createChatOnHost, test } from './helpers/structured-claude-stub'
import { buildFakeAgentCommandOverride } from './helpers/fake-agent-command-override'
import { addRepoWithWorkspaces, writeWorkspaceMeta } from './helpers/repo-with-workspaces'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { startHiddenRendererFrameCapture } from './helpers/hidden-renderer-frame-capture'
import { closeProjectMapWindows } from './helpers/project-map-windows'
import { RuntimeClient } from '../../src/cli/runtime-client'
import {
  agentSessionForkFingerprint,
  type AgentSessionForkParams
} from '../../src/shared/agent-session-fork'
import { orchestrationReferenceToken } from '../../src/shared/native-chat-orchestration-reference'
import {
  structuredAgentSessionPaneKey,
  structuredAgentSessionTabId
} from '../../src/shared/structured-agent-session-projection'
import { createStructuredAgentSessionOperationId } from '../../src/shared/structured-agent-session-mutation'
import { createStructuredAgentSessionId } from '../../src/shared/structured-agent-session-create'

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

/** Opens the chat's tab and sends one message, so the chat has a finished turn to hand over. */
async function sayInChat(page: Page, sessionId: string, message: string, replies: number) {
  const tab = page.locator(
    `[data-testid="sortable-tab"][data-tab-id="${structuredAgentSessionTabId(sessionId)}"]`
  )
  await expect(tab).toBeVisible({ timeout: 30_000 })
  await tab.click()
  const chat = page.locator('[data-native-chat-root="true"]')
  await chat.getByRole('textbox').fill(message)
  await chat.getByRole('textbox').press('Enter')
  await expect(chat.getByText('Stub reply.', { exact: true })).toHaveCount(replies, {
    timeout: 30_000
  })
}

/** Hands a chat's conversation to a new chat in a workspace, as the map's fork and merge do. */
async function forkChat(
  page: Page,
  input: { source: string; worktreeId: string; instruction: string; mergeSources?: string[] }
): Promise<string> {
  const childId = createStructuredAgentSessionId('claude', () => crypto.randomUUID())
  const intent = {
    sourceSessionId: input.source,
    originSessionId: input.source,
    cut: { kind: 'latest' as const },
    worktree: `id:${input.worktreeId}`,
    agent: 'claude',
    instruction: input.instruction,
    ...(input.mergeSources
      ? {
          mergeSources: input.mergeSources.map((sessionId) => ({
            sessionId,
            cut: { kind: 'latest' as const }
          }))
        }
      : {}),
    handoff: 'messages' as const
  }
  const params: AgentSessionForkParams = {
    envelope: {
      sessionId: childId,
      clientOperationId: createStructuredAgentSessionOperationId(() => crypto.randomUUID()),
      expectedRuntimeFence: null,
      payloadFingerprint: agentSessionForkFingerprint({
        ...intent,
        envelope: { sessionId: childId }
      })
    },
    ...intent
  }
  const forked = await page.evaluate(
    (forkParams) => window.api.runtime.call({ method: 'agentSession.fork', params: forkParams }),
    params
  )
  expect(forked, JSON.stringify(forked)).toMatchObject({ ok: true })
  return childId
}

test('draws every project on one time axis and jumps from a bar to the blueprint', async ({
  orcaPage: page,
  electronApp,
  claudeStub,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  test.skip(!SUPPORTED, 'the Claude stub wrapper is POSIX-only')
  test.setTimeout(420_000)
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

    // Project A: a coordinator with a worker that finished and was released, a worker in a derived workspace.
    const lead = await createChatOnHost(page, worktreeId)
    await sayInChat(page, lead, 'LEAD: coordinate the export', 1)
    const placements = [
      { displayName: 'CSV export', worktree: 'current' },
      {
        displayName: 'Cursor pagination',
        worktree: 'new-child',
        name: 'gt-pagination',
        setup: 'skip'
      }
    ]
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
    await composer.fill('Start the workers\n')
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
    await expect(chat.getByText('Stub reply.', { exact: true })).toHaveCount(2, { timeout: 30_000 })

    const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
    const leadClient = sessionClient(userDataDir, lead)
    const from = `orca_session_id:${lead}`
    const run = await leadClient.call<{ run: { id: string } }>('orchestration.runCreate', {
      objective: 'Export work',
      from
    })
    const workers: { dispatchId: string; taskId: string; sessionId: string; handle: string }[] = []
    for (const placement of placements) {
      const started = await leadClient.call<{ dispatchId: string; taskId: string; state: string }>(
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
      const dispatch = await leadClient.call<{
        dispatch: { assignee_orca_session_id: string; assignee_handle: string }
      }>('orchestration.dispatchShow', { task: started.result.taskId })
      workers.push({
        ...started.result,
        sessionId: dispatch.result.dispatch.assignee_orca_session_id,
        handle: dispatch.result.dispatch.assignee_handle
      })
    }
    const [finished, derived] = workers
    if (!finished || !derived) {
      throw new Error('Both workers should have started')
    }
    await sessionClient(userDataDir, finished.sessionId).call('orchestration.send', {
      from: finished.handle,
      subject: 'Done',
      type: 'worker_done',
      payload: JSON.stringify({
        taskId: finished.taskId,
        dispatchId: finished.dispatchId,
        outcome: 'succeeded'
      })
    })
    await leadClient.call('orchestration.workerRelease', { dispatch: finished.dispatchId })

    // A merged handoff of three chats: the coordinator and two more with a finished turn each.
    const sources: string[] = []
    for (const message of ['SRC-ONE: sketch', 'SRC-TWO: colour']) {
      const source = await createChatOnHost(page, worktreeId)
      await sayInChat(page, source, message, 1)
      sources.push(source)
    }
    const mergedId = await forkChat(page, {
      source: lead,
      worktreeId,
      instruction: 'MERGED: bring the three together',
      mergeSources: sources
    })

    // Project B: its own repo and a chat; and a folder workspace with a chat.
    const other = await addRepoWithWorkspaces(page, testInfo, 0)
    await page.evaluate((id) => window.__store!.getState().setActiveWorktree(id), other.mainId)
    const otherChat = await createChatOnHost(page, other.mainId)
    await sayInChat(page, otherChat, 'OTHER: a chat in the second project', 1)
    const folderPath = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'orca-growth-folder-')))
    registerPostElectronShutdownCleanup(async () =>
      rmSync(folderPath, { recursive: true, force: true })
    )
    const folderWorkspaceId = await page.evaluate(async (folderPath) => {
      const store = window.__store!
      const group = await window.api.projectGroups.create({
        name: 'Research notes',
        parentPath: folderPath,
        createdFrom: 'folder-scan'
      })
      await store.getState().fetchProjectGroups({ runtimeEnvironmentId: null, throwOnError: true })
      const folder = await store
        .getState()
        .createFolderWorkspace(
          { projectGroupId: group.id, name: 'Interviews', folderPath },
          { runtimeEnvironmentId: null }
        )
      if (!folder) {
        throw new Error('Could not create folder workspace')
      }
      return `folder:${folder.id}`
    }, folderPath)
    await page.evaluate((id) => window.__store!.getState().setActiveWorktree(id), folderWorkspaceId)
    const folderChat = await createChatOnHost(page, folderWorkspaceId)
    await sayInChat(page, folderChat, 'FOLDER: a chat in a folder workspace', 1)

    // A hand-off into the second project: the two ends sit in different projects.
    await page.evaluate((id) => window.__store!.getState().setActiveWorktree(id), other.mainId)
    const crossChild = await forkChat(page, {
      source: lead,
      worktreeId: other.mainId,
      instruction: 'CROSS: carry on in the other project'
    })

    const artifacts = path.join(process.cwd(), 'test-results', 'growth-tree')
    mkdirSync(artifacts, { recursive: true })
    const screenshot = async (name: string): Promise<void> => {
      const file = path.join(artifacts, `${name}.png`)
      await page.screenshot({ path: file, animations: 'disabled' })
      await testInfo.attach(name, { path: file, contentType: 'image/png' })
    }

    await page.evaluate(() => window.__store!.getState().openProjectMapPage())
    const map = page.locator('.project-map')
    await expect(map.getByRole('heading', { name: 'Project Map' })).toBeVisible()
    await expect(map.locator('[data-project-map-canvas]')).toBeVisible({ timeout: 30_000 })

    // Switch to the growth tree: every project shows, the blueprint canvas is gone.
    await map.getByRole('radio', { name: 'Growth tree' }).click()
    const tree = map.locator('[data-growth-tree]')
    await expect(tree).toBeVisible()
    await expect(map.locator('[data-project-map-canvas]')).toHaveCount(0)
    const bar = (id: string) => tree.locator(`[data-growth-bar="${id}"]`)
    for (const id of [lead, finished.sessionId, derived.sessionId, mergedId, ...sources]) {
      await expect(bar(paneKeyOf(id))).toBeVisible({ timeout: 30_000 })
    }
    await expect(bar(paneKeyOf(otherChat))).toBeVisible({ timeout: 30_000 })
    await expect(bar(paneKeyOf(folderChat))).toBeVisible({ timeout: 30_000 })
    // The worker that finished and was released is still on the tree.
    await expect(bar(paneKeyOf(finished.sessionId))).toBeVisible()
    // Three sources meet at one hollow point; a folder workspace has no derive line into it.
    await expect(tree.locator('[data-growth-join]')).toHaveCount(1)
    await expect(
      tree.locator('[data-growth-lane-label]', { hasText: 'Folder workspace' })
    ).toHaveCount(1)
    await expect(tree.locator('[data-growth-wire][data-kind="derive"]')).toHaveCount(1)
    await screenshot('growth-tree-overview')

    // One click selects: the dock opens and the chat's neighbours stay lit while the rest dim.
    await bar(paneKeyOf(mergedId)).click()
    const dock = tree.locator('[data-growth-dock]')
    await expect(dock).toBeVisible()
    await expect(bar(paneKeyOf(mergedId))).toHaveAttribute('aria-pressed', 'true')
    await expect(bar(paneKeyOf(sources[0]!))).toHaveAttribute('data-linked', 'true')
    await expect(bar(paneKeyOf(finished.sessionId))).toHaveAttribute('data-dimmed', 'true')
    await screenshot('growth-tree-selected')

    // Esc closes the dock and clears the selection.
    // An open tooltip owns the first Escape, so let any transient one close first.
    const tooltip = page.locator('[role="tooltip"]')
    if ((await tooltip.count()) > 0) {
      await page.keyboard.press('Escape')
      await expect(tooltip).toHaveCount(0)
    }
    await page.keyboard.press('Escape')
    await expect(dock).toHaveCount(0)
    await expect(bar(paneKeyOf(mergedId))).not.toHaveAttribute('aria-pressed', 'true')

    // Collapse a project group: its bars leave, the header stays.
    const groups = tree.locator('[data-growth-group]')
    await expect(groups).toHaveCount(3)
    const otherGroup = tree.locator(`[data-growth-group="${other.repoId}"]`)
    await otherGroup.click()
    await expect(otherGroup).toHaveAttribute('aria-expanded', 'false')
    await expect(bar(paneKeyOf(otherChat))).toHaveCount(0)
    await otherGroup.click()
    await expect(bar(paneKeyOf(otherChat))).toBeVisible()

    // Filter by status: a chat that is not working dims instead of leaving.
    await tree.getByRole('button', { name: 'Filter' }).click()
    await page.getByLabel('Working', { exact: true }).check()
    await page.keyboard.press('Escape')
    await expect(tree.locator('[data-growth-filter-clear]')).toBeVisible()
    await expect(bar(paneKeyOf(finished.sessionId))).toHaveAttribute('data-dimmed', 'true')
    await expect(bar(paneKeyOf(finished.sessionId))).toBeVisible()
    await screenshot('growth-tree-filtered')
    await tree.locator('[data-growth-filter-clear]').click()
    await expect(tree.locator('[data-growth-filter-clear]')).toHaveCount(0)

    // Each view keeps its own pan and zoom when you switch away and back.
    const zoomBefore = await tree.locator('text=/^\\d+%$/').first().textContent()
    await map.getByRole('radio', { name: 'Blueprint' }).click()
    await expect(map.locator('[data-project-map-canvas]')).toBeVisible()
    await expect(tree).toBeHidden()
    await map.getByRole('radio', { name: 'Growth tree' }).click()
    await expect(tree).toBeVisible()
    await expect(tree.locator('text=/^\\d+%$/').first()).toHaveText(zoomBefore ?? '')

    await expect(bar(paneKeyOf(crossChild))).toBeVisible({ timeout: 30_000 })
    await tree.getByRole('button', { name: 'Fit to view' }).click()

    // A hand-off into another project is a pin at each end, and a click on one lands on the other.
    const outPin = tree.locator('[data-growth-pin][data-kind="cross-out"]')
    const inPin = tree.locator('[data-growth-pin][data-kind="cross-in"]')
    await expect(outPin).toHaveCount(1)
    await expect(inPin).toHaveCount(1)
    await screenshot('growth-tree-cross-pins')
    await outPin.click()
    await expect(bar(paneKeyOf(crossChild))).toHaveAttribute('aria-pressed', 'true')
    await inPin.click()
    await expect(bar(paneKeyOf(lead))).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('Escape')

    // Linear time spends the same width on every millisecond of the span.
    const modeSelect = tree.getByRole('combobox', { name: 'Time scale' })
    await modeSelect.click()
    await page.getByRole('option', { name: 'Linear time' }).click()
    const startOf = async (id: string) =>
      Number(await bar(paneKeyOf(id)).getAttribute('data-start'))
    const leftOf = (id: string) =>
      bar(paneKeyOf(id)).evaluate((el) => Number.parseFloat(el.style.left))
    const [t1, t2, t3] = [
      await startOf(lead),
      await startOf(derived.sessionId),
      await startOf(mergedId)
    ]
    const [x1, x2, x3] = [
      await leftOf(lead),
      await leftOf(derived.sessionId),
      await leftOf(mergedId)
    ]
    expect(t1).toBeLessThan(t2)
    expect(t2).toBeLessThan(t3)
    expect((x2 - x1) / (t2 - t1)).toBeCloseTo((x3 - x2) / (t3 - t2), 6)
    await screenshot('growth-tree-linear')
    await modeSelect.click()
    await page.getByRole('option', { name: 'Compressed time' }).click()

    // A workspace made days ago starts its lane there; the quiet stretch after it folds, and
    // opening the fold draws that stretch to scale until it is closed again.
    await writeWorkspaceMeta(page, [
      { worktreeId: other.mainId, updates: { createdAt: Date.now() - 5 * 86_400_000 } }
    ])
    const foldToggle = tree.locator('[data-growth-fold-toggle]').first()
    await expect(foldToggle).toBeVisible({ timeout: 30_000 })
    await expect(tree.locator(`[data-growth-lane-start="${other.mainId}"]`)).not.toHaveAttribute(
      'data-approx',
      /.*/
    )
    await tree.getByRole('button', { name: 'Fit to view' }).click()
    const before = await leftOf(otherChat)
    await foldToggle.click({ position: { x: 6, y: 6 } })
    await expect(foldToggle).toHaveAttribute('aria-pressed', 'true')
    expect(await leftOf(otherChat)).toBeGreaterThan(before + 1_000)
    await screenshot('growth-tree-fold-open')
    await foldToggle.click({ position: { x: 6, y: 6 } })
    await expect(foldToggle).toHaveAttribute('aria-pressed', 'false')
    expect(await leftOf(otherChat)).toBeCloseTo(before, 3)
    await tree.getByRole('button', { name: 'Fit to view' }).click()

    // Zoomed far out, lanes become density strips and their lines one counted line.
    const world = tree.locator('[data-growth-world]')
    for (let i = 0; i < 12 && (await world.getAttribute('data-growth-tier')) !== 'summary'; i++) {
      await tree.getByRole('button', { name: 'Zoom out' }).click()
    }
    await expect(world).toHaveAttribute('data-growth-tier', 'summary')
    await expect(bar(paneKeyOf(lead))).toHaveCount(0)
    const counts = await tree
      .locator('[data-growth-bundle]')
      .evaluateAll((paths) => paths.map((path) => Number(path.getAttribute('data-count'))))
    expect(Math.max(...counts)).toBeGreaterThanOrEqual(2)
    await screenshot('growth-tree-summary')
    await tree.getByRole('button', { name: 'Fit to view' }).click()
    await expect(world).toHaveAttribute('data-growth-tier', 'bars')

    // Arrows walk the chats: down to the next lane, Enter selects, a second Enter jumps.
    await bar(paneKeyOf(lead)).click()
    await page.keyboard.press('ArrowDown')
    await expect(bar(paneKeyOf(derived.sessionId))).toHaveAttribute('data-cursor', 'true')
    await screenshot('growth-tree-cursor')
    await page.keyboard.press('Enter')
    await expect(bar(paneKeyOf(derived.sessionId))).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('Enter')
    await expect(map.locator('[data-project-map-canvas]')).toBeVisible()
    await expect(
      map.locator(`[data-project-map-node="${paneKeyOf(derived.sessionId)}"]`)
    ).toBeVisible({ timeout: 15_000 })
    await map.getByRole('radio', { name: 'Growth tree' }).click()
    await expect(tree).toBeVisible()

    // A double click jumps to the blueprint and lands on the same chat.
    await bar(paneKeyOf(derived.sessionId)).dblclick()
    await expect(map.locator('[data-project-map-canvas]')).toBeVisible()
    await expect(
      map.locator(`[data-project-map-node="${paneKeyOf(derived.sessionId)}"]`)
    ).toBeVisible({
      timeout: 15_000
    })
    await screenshot('growth-tree-jump-blueprint')

    // A message that carries another conversation draws a dashed line to it.
    await closeProjectMapWindows(map)
    const node = (id: string) => map.locator(`[data-project-map-node="${id}"]`)
    await node(paneKeyOf(sources[0]!)).click()
    const chatWindow = map.locator('[data-project-map-chat-window]')
    const windowComposer = chatWindow.getByRole('textbox')
    await expect(windowComposer).toBeVisible()
    await node(paneKeyOf(lead)).dragTo(windowComposer)
    await expect(windowComposer.locator('[data-native-chat-conversation-reference]')).toHaveCount(1)
    await windowComposer.pressSequentially('Use the lead plan.')
    await windowComposer.press('Enter')
    await expect(map.locator('.project-map-wire[data-kind="reference"]')).toHaveCount(1, {
      timeout: 30_000
    })
    await closeProjectMapWindows(map)
    await map.getByRole('radio', { name: 'Growth tree' }).click()
    const referenceWire = tree.locator('[data-growth-wire][data-kind="reference"]')
    await expect(referenceWire).toHaveCount(1, { timeout: 30_000 })
    await expect(referenceWire).toHaveAttribute(
      'data-growth-wire',
      `reference:${paneKeyOf(sources[0]!)}>${paneKeyOf(lead)}`
    )
    await screenshot('growth-tree-reference')
    await tree.getByRole('button', { name: 'Filter' }).click()
    await page.getByLabel('Referenced', { exact: true }).uncheck()
    await page.keyboard.press('Escape')
    await expect(referenceWire).toHaveCount(0)
    await tree.locator('[data-growth-filter-clear]').click()
    await expect(referenceWire).toHaveCount(1)

    // A chat hidden in the blueprint stays on the tree; jumping to it says why it is not there.
    await map.getByRole('radio', { name: 'Blueprint' }).click()
    await node(paneKeyOf(sources[1]!)).click({ button: 'right' })
    await page
      .locator('[data-slot="context-menu-content"] [data-project-map-action="hide"]')
      .click()
    await expect(node(paneKeyOf(sources[1]!))).toHaveCount(0)
    await map.getByRole('radio', { name: 'Growth tree' }).click()
    await bar(paneKeyOf(sources[1]!)).click()
    await expect(dock).toContainText('Hidden in the blueprint.')
    await bar(paneKeyOf(sources[1]!)).dblclick()
    const notice = map.locator('[data-growth-jump-notice="hidden"]')
    await expect(notice).toBeVisible({ timeout: 15_000 })
    await expect(map.locator('[data-project-map-canvas]')).toBeVisible()
    await screenshot('growth-tree-hidden-notice')
    await notice.getByRole('button', { name: 'Show it' }).click()
    await expect(notice).toHaveCount(0)
    await expect(node(paneKeyOf(sources[1]!))).toBeVisible({ timeout: 15_000 })
  } finally {
    await stopCapture()
  }
})
