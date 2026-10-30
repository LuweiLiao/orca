import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { expect } from './helpers/orca-app'
import { SUPPORTED, createChatOnHost, test } from './helpers/structured-claude-stub'
import { buildFakeAgentCommandOverride } from './helpers/fake-agent-command-override'
import { addRepoWithWorkspaces } from './helpers/repo-with-workspaces'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { startHiddenRendererFrameCapture } from './helpers/hidden-renderer-frame-capture'
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
    const mergedId = createStructuredAgentSessionId('claude', () => crypto.randomUUID())
    const intent = {
      sourceSessionId: lead,
      originSessionId: lead,
      cut: { kind: 'latest' as const },
      worktree: `id:${worktreeId}`,
      agent: 'claude',
      instruction: 'MERGED: bring the three together',
      mergeSources: sources.map((sessionId) => ({
        sessionId,
        cut: { kind: 'latest' as const }
      })),
      handoff: 'messages' as const
    }
    const forkParams: AgentSessionForkParams = {
      envelope: {
        sessionId: mergedId,
        clientOperationId: createStructuredAgentSessionOperationId(() => crypto.randomUUID()),
        expectedRuntimeFence: null,
        payloadFingerprint: agentSessionForkFingerprint({
          ...intent,
          envelope: { sessionId: mergedId }
        })
      },
      ...intent
    }
    const forked = await page.evaluate(
      (params) => window.api.runtime.call({ method: 'agentSession.fork', params }),
      forkParams
    )
    expect(forked, JSON.stringify(forked)).toMatchObject({ ok: true })

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

    // A double click jumps to the blueprint and lands on the same chat.
    await bar(paneKeyOf(derived.sessionId)).dblclick()
    await expect(map.locator('[data-project-map-canvas]')).toBeVisible()
    await expect(
      map.locator(`[data-project-map-node="${paneKeyOf(derived.sessionId)}"]`)
    ).toBeVisible({
      timeout: 15_000
    })
    await screenshot('growth-tree-jump-blueprint')
  } finally {
    await stopCapture()
  }
})
