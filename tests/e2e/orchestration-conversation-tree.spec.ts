import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { expect } from './helpers/orca-app'
import { SUPPORTED, createChatOnHost, test } from './helpers/structured-claude-stub'
import { buildFakeAgentCommandOverride } from './helpers/fake-agent-command-override'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { startHiddenRendererFrameCapture } from './helpers/hidden-renderer-frame-capture'
import { RuntimeClient } from '../../src/cli/runtime-client'
import { orchestrationReferenceToken } from '../../src/shared/native-chat-orchestration-reference'
import { structuredAgentSessionTabId } from '../../src/shared/structured-agent-session-projection'

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

test('keeps released workers in their originating conversation tree', async ({
  orcaPage: page,
  electronApp,
  claudeStub
}, testInfo) => {
  test.skip(!SUPPORTED, 'the Claude stub wrapper is POSIX-only')
  test.setTimeout(180_000)
  await waitForSessionReady(page)
  const stopCapture = await startHiddenRendererFrameCapture(page)
  try {
    await page.setViewportSize({ width: 1440, height: 960 })
    const worktreeId = await waitForActiveWorktree(page)
    await page.evaluate(async (command) => {
      const state = window.__store!.getState()
      await state.updateSettings({
        experimentalNativeChat: true,
        defaultTuiAgent: 'claude',
        tabAutoGenerateTitle: false,
        agentCmdOverrides: { claude: command }
      })
      state.setAgentActivityDisplayMode('full')
      state.setWorktreeCardProperties([
        ...new Set([...state.worktreeCardProperties, 'inline-agents' as const])
      ])
    }, buildFakeAgentCommandOverride(claudeStub.command))
    const parent = await createChatOnHost(page, worktreeId)
    const parentTabId = structuredAgentSessionTabId(parent)
    const parentTab = page.locator(`[data-testid="sortable-tab"][data-tab-id="${parentTabId}"]`)
    await expect(parentTab).toBeVisible({ timeout: 30_000 })
    await parentTab.click()
    const chat = page.locator('[data-native-chat-root="true"]')
    const workerFixtures = [
      {
        displayName: 'Authorization review of the delegated worker entry point policy',
        model: 'claude-opus-4-5-thinking',
        effort: 'high'
      },
      { displayName: 'Entry point review', model: 'sonnet', effort: 'medium' }
    ]
    const assignments = workerFixtures
      .map(({ displayName, model, effort }) =>
        orchestrationReferenceToken(
          {
            agent: 'claude',
            label: 'Claude',
            count: 1,
            task: `Review ${displayName}.`,
            model: { id: model, label: model },
            effort
          },
          displayName
        )
      )
      .join('\n')
    const composer = chat.getByRole('textbox')
    await composer.fill('Agent ownership review\n')
    await composer.press('End')
    await composer.evaluate((element, text) => {
      const clipboardData = new DataTransfer()
      clipboardData.setData('text/plain', text)
      element.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true })
      )
    }, assignments)
    await expect(composer.locator('[data-native-chat-orchestration="claude"]')).toHaveCount(2)
    await chat.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(chat.getByText('Stub reply.', { exact: true })).toBeVisible()
    await page.evaluate(
      (id) => window.__store!.getState().setTabCustomLabel(id, 'Agent ownership review'),
      parentTabId
    )
    const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
    const client = sessionClient(userDataDir, parent)
    const from = `orca_session_id:${parent}`
    const run = await client.call<{ run: { id: string } }>('orchestration.runCreate', {
      objective: 'Agent ownership review',
      from
    })
    const workers: { dispatchId: string; taskId: string; sessionId: string; handle: string }[] = []
    for (const { displayName, model, effort } of workerFixtures) {
      const started = await client.call<{ dispatchId: string; taskId: string; state: string }>(
        'orchestration.workerStart',
        {
          from,
          run: run.result.run.id,
          spec: `Review ${displayName}.`,
          displayName,
          worktree: 'current',
          agent: 'claude',
          model,
          effort,
          timeoutMs: 20_000
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
    const sidebar = page.locator('[data-worktree-sidebar]')
    const tree = page.locator('[data-worktree-sidebar] [aria-label="Agents"][role="tree"]')
    const children = tree.locator('.worktree-agent-lineage-children .agent-disclosure-row')
    await expect(tree).toHaveCount(1)
    await expect(children).toHaveCount(2)
    // Model stays inline; effort is hover-only metadata on the identity icon's title.
    await expect(children.nth(0)).toContainText('claude-opus-4-5-thinking')
    await expect(children.nth(0).locator('span.inline-flex.shrink-0[title]')).toHaveAttribute(
      'title',
      /high/
    )
    await expect(children.nth(1)).toContainText('sonnet')
    await expect(children.nth(1).locator('span.inline-flex.shrink-0[title]')).toHaveAttribute(
      'title',
      /medium/
    )
    const artifacts = path.join(process.cwd(), 'test-results', 'conversation-agent-tree')
    mkdirSync(artifacts, { recursive: true })
    const screenshot = async (name: string) => {
      const file = path.join(artifacts, `${name}.png`)
      await page.screenshot({ path: file, animations: 'disabled' })
      await tree.screenshot({
        path: path.join(artifacts, `${name}-tree.png`),
        animations: 'disabled'
      })
      await testInfo.attach(name, { path: file, contentType: 'image/png' })
    }
    const childSummary = tree.locator(
      '.worktree-agent-lineage-children > .compact-agent-summary-button'
    )
    const assertCollapsedSummary = async (): Promise<void> => {
      await expect(childSummary).toBeVisible()
      await expect(childSummary).toHaveAttribute('aria-expanded', 'false')
      await expect(childSummary).toHaveAttribute('aria-label', /2 agents.*Claude/)
      await expect(childSummary).toContainText('+1')
      const layout = await childSummary.evaluate((element) => {
        const bounds = element.getBoundingClientRect()
        return {
          width: element.clientWidth,
          scrollWidth: element.scrollWidth,
          iconsInside: [...element.querySelectorAll('svg')].every((icon) => {
            const iconBounds = icon.getBoundingClientRect()
            return iconBounds.left >= bounds.left && iconBounds.right <= bounds.right
          })
        }
      })
      expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width)
      expect(layout.iconsInside).toBe(true)
    }
    // Rows must read as ordinary transparent gray at rest (no permanent card fill/shadow,
    // except the normal focused-pane selection wash), the title must keep a readable
    // floor width, and the title/model/time/trailing-controls columns must lay out
    // left-to-right without overlapping, each fully inside its row and the sidebar —
    // at any sidebar width, model shrinks before title does.
    const MIN_READABLE_TITLE_WIDTH = 36
    const assertRowLayout = async (): Promise<void> => {
      // Why: move the cursor off the tree first so no row is left in a hover state,
      // which would otherwise read as a false "permanent fill" below.
      await page.mouse.move(2, 2)
      const sidebarBox = await sidebar.boundingBox()
      expect(sidebarBox).not.toBeNull()
      const count = await children.count()
      for (let index = 0; index < count; index++) {
        const row = children.nth(index)
        const isFocused = (await row.getAttribute('data-focused-agent-pane')) === 'true'
        if (!isFocused) {
          // The selection wash is the one legitimate resting fill; skip the fill
          // check for a focused row, but still check its layout below.
          const style = await row.evaluate((el) => {
            const computed = getComputedStyle(el)
            return { background: computed.backgroundColor, boxShadow: computed.boxShadow }
          })
          expect(['rgba(0, 0, 0, 0)', 'transparent']).toContain(style.background)
          expect(style.boxShadow).toBe('none')
        }
        const rowBox = await row.boundingBox()
        expect(rowBox).not.toBeNull()
        // Why: scope to the first-line flex row, not the whole disclosure row — a tool-step
        // or message line below it can carry its own unrelated .font-mono element. The full
        // row nests this as a child div; the compact row IS this flex line, so there's no
        // separate descendant to find — fall back to the row itself in that case.
        const firstLineLocator = row.locator('.flex.items-center.gap-1\\.5')
        const firstLine = (await firstLineLocator.count()) ? firstLineLocator.first() : row
        const titleBox = await firstLine.locator('.flex-1').first().boundingBox()
        const modelBox = await firstLine.locator('.font-mono').first().boundingBox()
        // Why: the full row's always-visible timestamp span is the only element combining
        // pointer-events-none with text-[10px]; the compact row's plain tabular-nums span
        // is the fallback when that combination isn't present.
        const timeLocator = firstLine.locator('span.pointer-events-none.text-\\[10px\\]')
        const timeBox = (await timeLocator.count())
          ? await timeLocator.first().boundingBox()
          : await firstLine.locator('span.tabular-nums').first().boundingBox()
        // Why: full rows reserve the trailing slot in DashboardAgentRowTrailingControls
        // (span.ml-auto); compact rows have no separate wrapper, so the time span
        // itself stands in as the trailing column there.
        const trailingLocator = firstLine.locator('span.ml-auto')
        const trailingBox = (await trailingLocator.count())
          ? await trailingLocator.first().boundingBox()
          : timeBox

        expect(titleBox).not.toBeNull()
        expect(titleBox!.width).toBeGreaterThanOrEqual(MIN_READABLE_TITLE_WIDTH)
        for (const box of [titleBox, modelBox, timeBox, trailingBox]) {
          if (!box || !rowBox || !sidebarBox) {
            continue
          }
          // Each visible column sits fully inside its own row...
          expect(box.x).toBeGreaterThanOrEqual(rowBox.x - 1)
          expect(box.x + box.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 1)
          // ...and inside the sidebar itself, so nothing spills past its edge at 220px.
          expect(box.x).toBeGreaterThanOrEqual(sidebarBox.x - 1)
          expect(box.x + box.width).toBeLessThanOrEqual(sidebarBox.x + sidebarBox.width + 1)
        }
        if (titleBox && modelBox) {
          expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(modelBox.x + 1)
        }
        if (modelBox && timeBox) {
          expect(modelBox.x + modelBox.width).toBeLessThanOrEqual(timeBox.x + 1)
        }
        if (timeBox && trailingBox && timeBox !== trailingBox) {
          expect(timeBox.x + timeBox.width).toBeLessThanOrEqual(
            trailingBox.x + trailingBox.width + 1
          )
        }
      }
    }
    await assertRowLayout()
    await screenshot('expanded')
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((t) => window.__store?.getState().updateSettings({ theme: t }), theme)
      await assertRowLayout()
      await screenshot(`expanded-${theme}`)
    }
    await page.evaluate(() => window.__store?.getState().updateSettings({ theme: 'light' }))
    await page.setViewportSize({ width: 1440, height: 960 })
    // Why: a real store write (not an inline style override) so useSidebarResize's own
    // layout effects can't silently re-clamp the width back out from under the assertion.
    await page.evaluate(() => window.__store?.getState().setSidebarWidth(220))
    await expect.poll(() => sidebar.evaluate((el) => el.getBoundingClientRect().width)).toBe(220)
    await assertRowLayout()
    await screenshot('expanded-narrow')
    await page.evaluate(() => window.__store?.getState().setSidebarWidth(280))
    await tree.locator('[data-agent-child-disclosure-button]').click()
    await expect(children).toHaveCount(0)
    await assertCollapsedSummary()
    await screenshot('collapsed')
    await page.evaluate(() => window.__store?.getState().setSidebarWidth(220))
    await assertCollapsedSummary()
    await screenshot('collapsed-narrow')
    await page.evaluate(() => window.__store?.getState().setSidebarWidth(280))
    await childSummary.click()
    await expect(children).toHaveCount(2)
    await expect(childSummary).toHaveCount(0)
    for (const [index, worker] of workers.entries()) {
      await children.nth(index).click()
      const tabId = structuredAgentSessionTabId(worker.sessionId)
      await expect
        .poll(() =>
          page.evaluate((wt) => window.__store!.getState().activeTabIdByWorktree[wt], worktreeId)
        )
        .toBe(tabId)
      await expect(page.getByText('Stub reply.', { exact: true }).first()).toBeVisible()
      await sessionClient(userDataDir, worker.sessionId).call('orchestration.send', {
        from: worker.handle,
        to: `run:${run.result.run.id}`,
        subject: 'Review completed',
        type: 'worker_done',
        payload: JSON.stringify({
          taskId: worker.taskId,
          dispatchId: worker.dispatchId,
          outcome: 'succeeded'
        })
      })
      const released = await client.call<{ state: string }>('orchestration.workerRelease', {
        dispatch: worker.dispatchId
      })
      expect(['released', 'already_released']).toContain(released.result.state)
    }
    await expect(children).toHaveCount(2)
    await parentTab.locator('[data-tab-close-button="true"]').click()
    await expect(parentTab).toHaveCount(0)
    await expect(tree).toHaveCount(1)
    await expect(children).toHaveCount(2)
    await page.reload()
    await waitForSessionReady(page)
    const dismissSetup = page.getByRole('button', { name: 'Dismiss setup scripts' })
    if (await dismissSetup.count()) {
      await dismissSetup.click()
    }
    await expect(children).toHaveCount(2)
    await children.first().click()
    await expect
      .poll(() =>
        page.evaluate((wt) => window.__store!.getState().activeTabIdByWorktree[wt], worktreeId)
      )
      .toBe(structuredAgentSessionTabId(workers[0]!.sessionId))
    await expect(page.getByText('Stub reply.', { exact: true }).first()).toBeVisible()
    await screenshot('released-reopened')
    await page.evaluate(() => window.__store!.getState().setAgentActivityDisplayMode('compact'))
    await expect(children).toHaveCount(2)
    await page.setViewportSize({ width: 1024, height: 768 })
    await assertRowLayout()
    await screenshot('compact')
    await page.evaluate(() => window.__store?.getState().updateSettings({ theme: 'dark' }))
    await assertRowLayout()
    await screenshot('compact-dark')
    await page.evaluate(() => window.__store?.getState().setSidebarWidth(220))
    await expect.poll(() => sidebar.evaluate((el) => el.getBoundingClientRect().width)).toBe(220)
    await assertRowLayout()
    await screenshot('compact-narrow')
    await page.evaluate(() => window.__store?.getState().setSidebarWidth(280))
    await page.evaluate(() => window.__store?.getState().updateSettings({ theme: 'light' }))
    await tree.locator('[data-agent-child-disclosure-button]').click()
    await expect(tree.locator('.compact-agent-expansion-grid').first()).toHaveAttribute(
      'aria-hidden',
      'true'
    )
    const collapsedExpansion = tree.locator('.compact-agent-expansion-grid').first()
    await expect(collapsedExpansion).toHaveAttribute('inert', '')
    await expect
      .poll(() => collapsedExpansion.evaluate((element) => element.getBoundingClientRect().height))
      .toBe(0)
    await assertCollapsedSummary()
    await screenshot('compact-collapsed')
    await page.evaluate(() => window.__store?.getState().updateSettings({ theme: 'dark' }))
    await page.evaluate(() => window.__store?.getState().setSidebarWidth(220))
    await assertCollapsedSummary()
    await screenshot('compact-collapsed-dark-narrow')
    await childSummary.focus()
    await childSummary.press('Enter')
    await expect(children.first()).toBeVisible()
    await expect(childSummary).toHaveCount(0)
    expect(
      await electronApp.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some((window) => window.isVisible())
      )
    ).toBe(false)
  } finally {
    await stopCapture()
  }
})
