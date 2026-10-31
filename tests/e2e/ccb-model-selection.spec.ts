import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { RuntimeClient } from '../../src/cli/runtime-client'
import { isAgentLaunchResult } from '../../src/shared/agent-launch-intent'
import { test as base, expect } from './helpers/orca-app'
import { startHiddenRendererFrameCapture } from './helpers/hidden-renderer-frame-capture'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

const test = base.extend<{ ccbStub: { command: string; log: string } }>({
  // oxlint-disable-next-line no-empty-pattern -- Playwright requires destructured fixture arguments.
  ccbStub: async ({}, provideFixture) => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'orca-ccb-models-'))
    const command = path.join(directory, process.platform === 'win32' ? 'ccb.cmd' : 'ccb')
    const log = path.join(directory, 'launches.jsonl')
    const script = path.resolve('tests/e2e/fixtures/structured-claude-stub.cjs')
    const quote = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`
    writeFileSync(
      command,
      process.platform === 'win32'
        ? `@echo off\r\n"${process.execPath}" "${script}" "${log}" %*\r\n`
        : `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(script)} ${quote(log)} "$@"\n`
    )
    chmodSync(command, 0o755)
    try {
      await provideFixture({ command, log })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }
})

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

test.use({
  orcaAppExtraEnv: { ORCA_BACKGROUND_LAUNCH: '1', ORCA_E2E_STUB_EFFORT_CATALOG: '1' }
})

test('CCB host defaults persist and explicit chat choices take priority', async ({
  orcaPage: page,
  ccbStub
}, testInfo) => {
  await waitForSessionReady(page)
  const worktreeId = await waitForActiveWorktree(page)
  const stopCapture = await startHiddenRendererFrameCapture(page)
  try {
    await page.evaluate(async (command) => {
      const state = window.__store!.getState()
      await state.updateSettingsOrThrow({
        uiLanguage: 'en',
        experimentalNativeChat: true,
        tabAutoGenerateTitle: false,
        agentCmdOverrides: { ccb: `"${command}"` },
        agentLaunchChoices: {}
      })
      window.__store!.setState({ detectedAgentIds: ['ccb'] })
      state.openSettingsTarget({ pane: 'agents', repoId: null })
      state.openSettingsPage()
    }, ccbStub.command)
    const row = page.locator('div.py-3').filter({ has: page.getByText('ccb', { exact: true }) })
    const expand = row.getByRole('button', { name: 'Expand agent settings', exact: true })
    if (await expand.isVisible()) {
      await expand.click()
    }
    const defaults = row.locator('[data-agent-model-defaults="ccb"]')
    await defaults.getByRole('combobox', { name: 'Default model', exact: true }).click()
    await page.getByRole('option', { name: 'Sonnet', exact: true }).click()
    await defaults.getByRole('combobox', { name: 'Default effort', exact: true }).click()
    await page.getByRole('option', { name: 'Low', exact: true }).click()
    await expect
      .poll(() =>
        page.evaluate(async () => (await window.api.settings.get()).agentLaunchChoices?.ccb)
      )
      .toEqual({ model: 'sonnet', options: { effort: 'low' } })
    await defaults.screenshot({ path: testInfo.outputPath('ccb-default-model-effort.png') })
    await page.reload()
    await waitForSessionReady(page)
    expect(
      await page.evaluate(async () => (await window.api.settings.get()).agentLaunchChoices?.ccb)
    ).toEqual({ model: 'sonnet', options: { effort: 'low' } })
    await page.evaluate(() => window.__store!.getState().closeSettingsPage())
    for (const explicit of [false, true]) {
      const launch = await page.evaluate(
        ({ worktreeId, explicit }) =>
          window.api.runtime.call({
            method: 'agent.launch',
            params: {
              agent: 'ccb',
              target: { kind: 'existing', worktree: `id:${worktreeId}` },
              surface: 'chat',
              ...(explicit ? { sessionOptions: { model: 'opus', effort: 'high' } } : {}),
              prompt: {
                text: explicit ? 'Explicit choice.' : 'Global defaults.',
                delivery: 'submit'
              },
              presentation: 'background'
            }
          }),
        { worktreeId, explicit }
      )
      expect(launch).toMatchObject({ ok: true, result: { outcome: { kind: 'structured' } } })
      await expect
        .poll(() =>
          readFileSync(ccbStub.log, 'utf8')
            .split('\n')
            .some(
              (line) =>
                line.includes(`"--model","${explicit ? 'opus' : 'sonnet'}"`) &&
                line.includes(`"--effort","${explicit ? 'high' : 'low'}"`)
            )
        )
        .toBe(true)
    }
  } finally {
    await stopCapture()
  }
})

test('CCB discovers its own models and retains a selected model and effort', async ({
  orcaPage: page,
  electronApp,
  ccbStub
}, testInfo) => {
  await waitForSessionReady(page)
  const stopCapture = await startHiddenRendererFrameCapture(page)
  try {
    const worktreeId = await waitForActiveWorktree(page)
    await page.evaluate(async (command) => {
      await window.__store!.getState().updateSettings({
        experimentalNativeChat: true,
        tabAutoGenerateTitle: false,
        agentCmdOverrides: { ccb: `"${command}"` }
      })
    }, ccbStub.command)
    const launch = await page.evaluate(
      (worktree) =>
        window.api.runtime.call({
          method: 'agent.launch',
          params: {
            agent: 'ccb',
            target: { kind: 'existing', worktree: `id:${worktree}` },
            surface: 'chat',
            sessionOptions: { model: 'opus', effort: 'high' },
            prompt: { text: 'Fixture greeting.', delivery: 'submit' },
            presentation: 'background'
          }
        }),
      worktreeId
    )
    expect(launch, JSON.stringify(launch)).toMatchObject({
      ok: true,
      result: { outcome: { kind: 'structured' } }
    })
    if (
      !launch.ok ||
      !isAgentLaunchResult(launch.result) ||
      launch.result.outcome.kind !== 'structured'
    ) {
      throw new Error('CCB did not create a structured chat')
    }
    const sessionId = launch.result.outcome.sessionId
    await page.getByRole('treeitem').filter({ hasText: 'Fixture greeting.' }).click()
    const chat = page.locator('[data-native-chat-root="true"]')
    await expect(chat.getByText('Stub reply.', { exact: true })).toBeVisible()
    await expect.poll(() => readFileSync(ccbStub.log, 'utf8')).toMatch(/"--model","opus"/)
    expect(readFileSync(ccbStub.log, 'utf8')).toMatch(/"--effort","high"/)
    await page.evaluate(() => window.__store!.setState({ detectedAgentIds: ['ccb'] }))
    await page.getByRole('button', { name: /^(Orchestration agents|编排智能体)$/ }).click()
    const picker = page.getByRole('dialog')
    await picker.getByText('ccb', { exact: true }).locator('..').getByRole('checkbox').check()
    await picker.getByRole('spinbutton', { name: /ccb (Agent count|智能体数量)/ }).fill('2')
    await picker.getByRole('combobox', { name: /^ccb (Model|模型)$/ }).click()
    await page.getByRole('option', { name: 'Opus', exact: true }).click()
    await picker.getByRole('combobox', { name: /^ccb (Effort|推理强度)$/ }).click()
    await page.getByRole('option', { name: 'High', exact: true }).click()
    await picker.screenshot({ path: testInfo.outputPath('ccb-model-picker.png') })
    await picker.getByRole('button', { name: /^(Add to message|加入消息)$/ }).click()
    const assignment = chat.locator('[data-native-chat-orchestration="ccb"]')
    await expect(assignment).toContainText('opus')
    await expect(assignment).toContainText('high')
    await expect(assignment).toContainText('2')
    await page.screenshot({ path: testInfo.outputPath('ccb-model-assignment.png') })
    await chat.getByRole('button', { name: /^(Send|发送)$/, exact: true }).click()
    await expect(chat.getByText('Stub reply.', { exact: true })).toHaveCount(2)
    const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
    const client = callerClient(userDataDir, sessionId)
    const from = `orca_session_id:${sessionId}`
    await client.call('orchestration.runCreate', { from, objective: 'CCB launch options' })
    const worker = await client.call<{
      dispatchId: string
      taskId: string
      state: string
      mode: { mode: string }
      launch: { effective: { agent: string; model: string; effort: string } }
    }>('orchestration.workerStart', {
      from,
      spec: 'Fixture CCB worker.',
      worktree: 'current',
      agent: 'ccb',
      model: 'opus',
      effort: 'high',
      timeoutMs: 20_000
    })
    expect(worker.result).toMatchObject({
      state: 'ready',
      mode: { mode: 'structured' },
      launch: { effective: { agent: 'ccb', model: 'opus', effort: 'high' } }
    })
    const dispatched = await client.call<{
      dispatch: { assignee_orca_session_id: string; assignee_handle: string }
    }>('orchestration.dispatchShow', { task: worker.result.taskId })
    const workerClient = callerClient(
      userDataDir,
      dispatched.result.dispatch.assignee_orca_session_id
    )
    await workerClient.call('orchestration.send', {
      from: dispatched.result.dispatch.assignee_handle,
      subject: 'Fixture complete',
      type: 'worker_done',
      payload: JSON.stringify({
        taskId: worker.result.taskId,
        dispatchId: worker.result.dispatchId,
        outcome: 'succeeded'
      })
    })
    await client.call('orchestration.workerRelease', { dispatch: worker.result.dispatchId })
    expect(readFileSync(ccbStub.log, 'utf8').match(/"--model","opus"/g)?.length).toBeGreaterThan(1)
  } finally {
    await stopCapture()
  }
})
