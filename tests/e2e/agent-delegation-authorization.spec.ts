import { randomUUID } from 'node:crypto'
import type { Page } from '@stablyai/playwright-test'
import { RuntimeClient } from '../../src/cli/runtime-client'
import { orchestrationReferenceToken } from '../../src/shared/native-chat-orchestration-reference'
import {
  structuredAgentSessionMessageSendMutation,
  structuredAgentSessionSendBody
} from '../../src/shared/structured-agent-session-send-mutation'
import { structuredAgentSessionTabId } from '../../src/shared/structured-agent-session-projection'
import { createStructuredAgentSessionOperationId } from '../../src/shared/structured-agent-session-mutation'
import { expect } from './helpers/orca-app'
import { buildFakeAgentCommandOverride } from './helpers/fake-agent-command-override'
import { startHiddenRendererFrameCapture } from './helpers/hidden-renderer-frame-capture'
import { SUPPORTED, createChatOnHost, test } from './helpers/structured-claude-stub'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

function callerClient(userDataDir: string, sessionId: string): RuntimeClient {
  const previous = process.env.ORCA_AGENT_SESSION_ID
  process.env.ORCA_AGENT_SESSION_ID = sessionId
  try {
    return new RuntimeClient(userDataDir, 30_000, null, null)
  } finally {
    if (previous === undefined) {
      delete process.env.ORCA_AGENT_SESSION_ID
    } else {
      process.env.ORCA_AGENT_SESSION_ID = previous
    }
  }
}

async function insertAssignment(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^(Orchestration agents|编排智能体)$/ }).click()
  const picker = page.getByRole('dialog')
  await picker.getByText('Claude', { exact: true }).locator('..').getByRole('checkbox').check()
  await picker.getByRole('textbox', { name: /Claude (Task|负责事项)/ }).fill('Review authorization')
  await picker.getByRole('spinbutton', { name: /Claude (Agent count|智能体数量)/ }).fill('1')
  await picker.getByRole('combobox', { name: 'Claude Model' }).click()
  await page.getByRole('option', { name: 'Opus', exact: true }).click()
  await picker.getByRole('combobox', { name: 'Claude Effort' }).click()
  await page.getByRole('option', { name: 'High', exact: true }).click()
  await picker.getByRole('button', { name: /^(Add to message|加入消息)$/ }).click()
}

type WorkerReceipt = { state: string; taskId: string; dispatchId: string }

test.use({ orcaAppExtraEnv: { ORCA_E2E_STUB_EFFORT_CATALOG: '1' } })

test('a confirmed card allows exactly one matching worker across retries and new runs', async ({
  orcaPage: page,
  electronApp,
  claudeStub
}, testInfo) => {
  test.skip(!SUPPORTED, 'the Claude stub wrapper is POSIX-only')
  test.setTimeout(180_000)
  await waitForSessionReady(page)
  const stopCapture = await startHiddenRendererFrameCapture(page)
  try {
    const worktreeId = await waitForActiveWorktree(page)
    await page.evaluate(async (command) => {
      await window.__store!.getState().updateSettings({
        experimentalNativeChat: true,
        defaultTuiAgent: 'claude',
        tabAutoGenerateTitle: false,
        agentCmdOverrides: { claude: command }
      })
    }, buildFakeAgentCommandOverride(claudeStub.command))
    const sessionId = await createChatOnHost(page, worktreeId)
    const parentTab = page.locator(
      `[data-testid="sortable-tab"][data-tab-id="${structuredAgentSessionTabId(sessionId)}"]`
    )
    await parentTab.click()
    const chat = page.locator('[data-native-chat-root="true"]')
    const composer = chat.getByRole('textbox')
    await composer.fill('Arrange one Claude agent to review authorization.')
    await chat.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(chat.getByText('Stub reply.', { exact: true })).toBeVisible()

    const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
    const client = callerClient(userDataDir, sessionId)
    const from = `orca_session_id:${sessionId}`
    await client.call('orchestration.runCreate', { from, objective: 'Review authorization' })
    const params = {
      from,
      worktree: 'current',
      agent: 'claude',
      model: 'opus',
      effort: 'high',
      spec: 'Review authorization',
      timeoutMs: 20_000
    }
    const refused = { code: 'agent_delegation_unauthorized' }
    await expect(client.call('orchestration.workerStart', params)).rejects.toMatchObject(refused)
    await expect(
      client.call('agent.launch', {
        agent: 'claude',
        target: { kind: 'existing', worktree: `id:${worktreeId}` }
      })
    ).rejects.toMatchObject(refused)

    const history = await client.call<{ ok: boolean; page: { fence: number } }>(
      'agentSession.history',
      { sessionId, direction: 'tail', limit: 1 }
    )
    expect(history.result.ok).toBe(true)
    const plainCard = orchestrationReferenceToken(
      {
        agent: 'claude',
        label: 'Claude',
        count: 1,
        task: 'Review authorization',
        model: { id: 'opus', label: 'Opus' },
        effort: 'high'
      },
      '1 Claude opus high'
    )
    const rawSend = structuredAgentSessionMessageSendMutation({
      sessionId,
      clientOperationId: createStructuredAgentSessionOperationId(randomUUID),
      expectedRuntimeFence: history.result.page.fence,
      body: structuredAgentSessionSendBody(`Example link: ${plainCard}`, [])
    })
    const rawReply = await page.evaluate(
      (send) => window.api.runtime.call({ method: 'agentSession.send', params: send }),
      rawSend
    )
    expect(rawReply).toMatchObject({ ok: true, result: { ok: true } })
    await expect(chat.getByText('Stub reply.', { exact: true })).toHaveCount(2)
    await expect(client.call('orchestration.workerStart', params)).rejects.toMatchObject(refused)

    await insertAssignment(page)
    await expect(composer.locator('[data-native-chat-orchestration="claude"]')).toContainText(
      'effort: high'
    )
    await page.screenshot({ path: testInfo.outputPath('assignment-before-send.png') })
    await expect(client.call('orchestration.workerStart', params)).rejects.toMatchObject(refused)
    await chat.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(chat.getByText('Stub reply.', { exact: true })).toHaveCount(3)
    await expect(
      client.call('orchestration.workerStart', { ...params, model: 'sonnet' })
    ).rejects.toMatchObject(refused)
    await expect(
      client.call('orchestration.workerStart', { ...params, effort: 'low' })
    ).rejects.toMatchObject(refused)

    const requests = [randomUUID(), randomUUID()]
    const starts = await Promise.allSettled(
      requests.map((orchestrationRequestId) =>
        client.call<WorkerReceipt>('orchestration.workerStart', params, {
          orchestrationRequestId
        })
      )
    )
    const successIndex = starts.findIndex((result) => result.status === 'fulfilled')
    expect(starts.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(starts.filter((result) => result.status === 'rejected')).toHaveLength(1)
    const success = starts[successIndex]
    if (!success || success.status !== 'fulfilled') {
      throw new Error('The confirmed assignment did not start a worker')
    }
    const worker = success.value.result
    expect(worker.state).toBe('ready')
    for (const result of starts) {
      if (result.status === 'rejected') {
        expect(result.reason).toMatchObject(refused)
      }
    }
    const replay = await client.call<WorkerReceipt>('orchestration.workerStart', params, {
      orchestrationRequestId: requests[successIndex]
    })
    expect(replay.result).toMatchObject({ dispatchId: worker.dispatchId, state: 'ready' })

    const dispatched = await client.call<{
      dispatch: { assignee_orca_session_id: string; assignee_handle: string }
    }>('orchestration.dispatchShow', { task: worker.taskId })
    const workerClient = callerClient(
      userDataDir,
      dispatched.result.dispatch.assignee_orca_session_id
    )
    const workerFrom = dispatched.result.dispatch.assignee_handle
    await workerClient.call('orchestration.send', {
      from: workerFrom,
      subject: 'Review complete',
      type: 'worker_done',
      payload: JSON.stringify({
        taskId: worker.taskId,
        dispatchId: worker.dispatchId,
        outcome: 'succeeded'
      })
    })
    await workerClient.call('orchestration.runCreate', {
      from: workerFrom,
      objective: 'Attempt an unauthorized child'
    })
    await expect(
      workerClient.call('orchestration.workerStart', { ...params, from: workerFrom })
    ).rejects.toMatchObject(refused)
    await client.call('orchestration.workerRelease', { dispatch: worker.dispatchId })
    await client.call('orchestration.runCreate', { from, objective: 'Attempt to reset quota' })
    await expect(client.call('orchestration.workerStart', params)).rejects.toMatchObject(refused)
    await parentTab.click()
    await page.screenshot({ path: testInfo.outputPath('assignment-after-worker.png') })
  } finally {
    await stopCapture()
  }
})

test('agents named in words go out as cards with the message, and a dismissed request grants nothing', async ({
  orcaPage: page,
  electronApp,
  claudeStub
}, testInfo) => {
  test.skip(!SUPPORTED, 'the Claude stub wrapper is POSIX-only')
  test.setTimeout(180_000)
  await waitForSessionReady(page)
  const stopCapture = await startHiddenRendererFrameCapture(page)
  try {
    const worktreeId = await waitForActiveWorktree(page)
    await page.evaluate(async (command) => {
      await window.__store!.getState().updateSettings({
        experimentalNativeChat: true,
        defaultTuiAgent: 'claude',
        tabAutoGenerateTitle: false,
        agentCmdOverrides: { claude: command }
      })
    }, buildFakeAgentCommandOverride(claudeStub.command))
    const sessionId = await createChatOnHost(page, worktreeId)
    await page
      .locator(
        `[data-testid="sortable-tab"][data-tab-id="${structuredAgentSessionTabId(sessionId)}"]`
      )
      .click()
    const chat = page.locator('[data-native-chat-root="true"]')
    const composer = chat.getByRole('textbox')
    const named = chat.locator('[data-native-chat-text-delegation="claude"]')
    const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
    const client = callerClient(userDataDir, sessionId)
    const from = `orca_session_id:${sessionId}`
    const params = {
      from,
      worktree: 'current',
      agent: 'claude',
      model: 'opus',
      effort: 'high',
      spec: 'Review authorization',
      timeoutMs: 20_000
    }
    const refused = { code: 'agent_delegation_unauthorized' }
    const request = 'Spawn 1 claude opus high agent to review authorization.'
    const replies = chat.getByText('Stub reply.', { exact: true })
    // A run needs a live session, and only a sent message starts one.
    await composer.fill('Review the authorization boundary.')
    await chat.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(replies).toHaveCount(1)
    await client.call('orchestration.runCreate', { from, objective: 'Review authorization' })

    await composer.fill(request)
    await expect(named).toContainText('effort: high')
    await page.screenshot({ path: testInfo.outputPath('text-request-before-send.png') })
    await expect(client.call('orchestration.workerStart', params)).rejects.toMatchObject(refused)
    await chat.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(replies).toHaveCount(2)
    await expect(named).toHaveCount(0)
    await expect(chat.locator('[data-native-chat-orchestration="claude"]')).toHaveCount(1)
    const started = await client.call<WorkerReceipt>('orchestration.workerStart', params)
    expect(started.result.state).toBe('ready')
    await expect(client.call('orchestration.workerStart', params)).rejects.toMatchObject(refused)
    await client.call('orchestration.workerStop', { dispatch: started.result.dispatchId })
    await client.call('orchestration.workerRelease', { dispatch: started.result.dispatchId })

    await composer.fill(request)
    await expect(named).toContainText('effort: high')
    await chat
      .getByRole('button', {
        name: /Don't authorize agents with this message|这条消息不授权智能体/
      })
      .click()
    await expect(named).toHaveCount(0)
    await chat.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(replies).toHaveCount(3)
    await client.call('orchestration.runCreate', { from, objective: 'Review again' })
    await expect(client.call('orchestration.workerStart', params)).rejects.toMatchObject(refused)
    await page.screenshot({ path: testInfo.outputPath('text-request-dismissed.png') })
  } finally {
    await stopCapture()
  }
})

test.describe('text proposal confirmation', () => {
  const proposal = orchestrationReferenceToken(
    {
      agent: 'claude',
      label: 'Claude',
      count: 1,
      task: 'Review authorization',
      model: { id: 'opus', label: 'Opus' },
      effort: 'high'
    },
    '1 Claude (model: Opus; effort: high)'
  )
  test.use({
    orcaAppExtraEnv: {
      ORCA_E2E_STUB_EFFORT_CATALOG: '1',
      ORCA_E2E_STUB_REPLY_TEXT: proposal
    }
  })

  test('a proposal grants nothing until the user inserts and submits its card', async ({
    orcaPage: page,
    electronApp,
    claudeStub
  }, testInfo) => {
    test.skip(!SUPPORTED, 'the Claude stub wrapper is POSIX-only')
    test.setTimeout(120_000)
    await waitForSessionReady(page)
    const stopCapture = await startHiddenRendererFrameCapture(page)
    try {
      const worktreeId = await waitForActiveWorktree(page)
      await page.evaluate(async (command) => {
        await window.__store!.getState().updateSettings({
          experimentalNativeChat: true,
          defaultTuiAgent: 'claude',
          tabAutoGenerateTitle: false,
          agentCmdOverrides: { claude: command }
        })
      }, buildFakeAgentCommandOverride(claudeStub.command))
      const sessionId = await createChatOnHost(page, worktreeId)
      await page
        .locator(
          `[data-testid="sortable-tab"][data-tab-id="${structuredAgentSessionTabId(sessionId)}"]`
        )
        .click()
      const chat = page.locator('[data-native-chat-root="true"]')
      const composer = chat.getByRole('textbox')
      await composer.fill('Arrange one Claude Opus agent with high effort to review authorization.')
      await chat.getByRole('button', { name: 'Send', exact: true }).click()
      const proposedCard = chat.locator('[data-native-chat-orchestration="claude"]').first()
      await expect(proposedCard).toContainText('effort: high')
      const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
      const client = callerClient(userDataDir, sessionId)
      const from = `orca_session_id:${sessionId}`
      await client.call('orchestration.runCreate', { from, objective: 'Review authorization' })
      const params = {
        from,
        worktree: 'current',
        agent: 'claude',
        model: 'opus',
        effort: 'high',
        spec: 'Review authorization',
        timeoutMs: 20_000
      }
      const refused = { code: 'agent_delegation_unauthorized' }
      await expect(client.call('orchestration.workerStart', params)).rejects.toMatchObject(refused)
      await page.screenshot({ path: testInfo.outputPath('proposal-awaiting-confirmation.png') })
      await proposedCard.getByRole('button', { name: /Add to message|加入消息/ }).click()
      await expect(composer.locator('[data-native-chat-orchestration="claude"]')).toContainText(
        'effort: high'
      )
      await expect(client.call('orchestration.workerStart', params)).rejects.toMatchObject(refused)
      await chat.getByRole('button', { name: 'Send', exact: true }).click()
      await expect(composer.locator('[data-native-chat-orchestration="claude"]')).toHaveCount(0)
      await expect(chat.getByRole('button', { name: /Add to message|加入消息/ })).toHaveCount(2)
      const started = await client.call<WorkerReceipt>('orchestration.workerStart', params)
      expect(started.result.state).toBe('ready')
      await page.screenshot({ path: testInfo.outputPath('proposal-confirmed.png') })
      await client.call('orchestration.workerStop', { dispatch: started.result.dispatchId })
      await client.call('orchestration.workerRelease', { dispatch: started.result.dispatchId })
    } finally {
      await stopCapture()
    }
  })
})

test.describe('confirming every proposed card at once', () => {
  const card = (effort: string) =>
    orchestrationReferenceToken(
      {
        agent: 'claude',
        label: 'Claude',
        count: 1,
        task: `Review with ${effort} effort`,
        model: { id: 'opus', label: 'Opus' },
        effort
      },
      `1 Claude (model: Opus; effort: ${effort})`
    )
  test.use({
    orcaAppExtraEnv: {
      ORCA_E2E_STUB_EFFORT_CATALOG: '1',
      ORCA_E2E_STUB_REPLY_TEXT: `${card('high')}\n\n${card('low')}`
    }
  })

  test('one click sends every proposed card and grants exactly those agents', async ({
    orcaPage: page,
    electronApp,
    claudeStub
  }, testInfo) => {
    test.skip(!SUPPORTED, 'the Claude stub wrapper is POSIX-only')
    test.setTimeout(120_000)
    await waitForSessionReady(page)
    const stopCapture = await startHiddenRendererFrameCapture(page)
    try {
      const worktreeId = await waitForActiveWorktree(page)
      await page.evaluate(async (command) => {
        await window.__store!.getState().updateSettings({
          experimentalNativeChat: true,
          defaultTuiAgent: 'claude',
          tabAutoGenerateTitle: false,
          agentCmdOverrides: { claude: command }
        })
      }, buildFakeAgentCommandOverride(claudeStub.command))
      const sessionId = await createChatOnHost(page, worktreeId)
      await page
        .locator(
          `[data-testid="sortable-tab"][data-tab-id="${structuredAgentSessionTabId(sessionId)}"]`
        )
        .click()
      const chat = page.locator('[data-native-chat-root="true"]')
      const composer = chat.getByRole('textbox')
      await composer.fill('Arrange Claude Opus reviewers for authorization, one high and one low.')
      await chat.getByRole('button', { name: 'Send', exact: true }).click()
      const addAll = chat.getByRole('button', { name: /Add all 2 and send|全部 2 张加入并发送/ })
      await expect(addAll).toHaveCount(1)
      const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
      const client = callerClient(userDataDir, sessionId)
      const from = `orca_session_id:${sessionId}`
      await client.call('orchestration.runCreate', { from, objective: 'Review authorization' })
      const params = (effort: string) => ({
        from,
        worktree: 'current',
        agent: 'claude',
        model: 'opus',
        effort,
        spec: 'Review authorization',
        timeoutMs: 20_000
      })
      const refused = { code: 'agent_delegation_unauthorized' }
      await expect(client.call('orchestration.workerStart', params('high'))).rejects.toMatchObject(
        refused
      )
      await page.screenshot({ path: testInfo.outputPath('proposals-before-confirm.png') })
      await addAll.click()
      await expect(addAll).toHaveCount(2)
      await expect(composer.locator('[data-native-chat-orchestration="claude"]')).toHaveCount(0)
      const high = await client.call<WorkerReceipt>('orchestration.workerStart', params('high'))
      const low = await client.call<WorkerReceipt>('orchestration.workerStart', params('low'))
      expect([high.result.state, low.result.state]).toEqual(['ready', 'ready'])
      await expect(client.call('orchestration.workerStart', params('high'))).rejects.toMatchObject(
        refused
      )
      await page.screenshot({ path: testInfo.outputPath('proposals-confirmed.png') })
      for (const worker of [high, low]) {
        await client.call('orchestration.workerStop', { dispatch: worker.result.dispatchId })
        await client.call('orchestration.workerRelease', { dispatch: worker.result.dispatchId })
      }
    } finally {
      await stopCapture()
    }
  })
})
