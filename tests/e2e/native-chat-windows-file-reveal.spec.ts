import { randomUUID } from 'node:crypto'
import { join, normalize } from 'node:path'
import { writeFileSync } from 'node:fs'
import { test, expect } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActiveTerminalManager } from './helpers/terminal'
import { claudeTranscriptLines } from './helpers/native-chat-transcript-fixture'

test('chat reveals slash-prefixed Windows Markdown files through the real shell path checks', async ({
  orcaPage,
  electronApp,
  testRepoPath
}, testInfo) => {
  test.skip(process.platform !== 'win32', 'Windows drive-path reveal contract')
  test.setTimeout(180_000)
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)
  await waitForActiveTerminalManager(orcaPage, 30_000)
  const descriptor = await waitForActivePaneHookDescriptor(orcaPage)
  const [tabId] = descriptor.paneKey.split(':')
  const sessionId = `e2e-file-reveal-${randomUUID()}`
  const transcriptPath = testInfo.outputPath(`${sessionId}.jsonl`)
  const ordinary = join(testRepoPath, 'README.md')
  const spaced = join(testRepoPath, '\u62a5\u544a file with spaces #100%.md')
  writeFileSync(spaced, '# File reveal fixture\n')
  const href = (path: string) => `/${path.replaceAll('\\', '/')}`
  writeFileSync(
    transcriptPath,
    claudeTranscriptLines({
      sessionId,
      userText: 'Show the output files.',
      assistantText: [
        `[Ordinary file](<${href(ordinary)}>)`,
        `[Escaped file](<${encodeURI(href(spaced)).replaceAll('#', '%23')}>)`,
        `[Missing file](<${href(join(testRepoPath, 'missing-file.md'))}>)`
      ].join('\n\n')
    })
  )
  await electronApp.evaluate(({ shell }) => {
    // Keep the real path validation while preventing Explorer from taking desktop focus.
    shell.showItemInFolder = (filePath) => {
      process.env.ORCA_E2E_REVEALED_PATH = filePath
    }
  })
  await orcaPage.evaluate(
    async ({ paneKey, worktreeId, tabId, sessionId, transcriptPath }) => {
      const store = window.__store
      if (!store) {
        throw new Error('Store unavailable')
      }
      const state = store.getState()
      await state.updateSettings({ experimentalNativeChat: true, uiLanguage: 'en' })
      state.setAgentStatus(
        paneKey,
        { state: 'done', prompt: 'File reveal proof', agentType: 'claude' },
        'Claude',
        undefined,
        { worktreeId },
        {
          providerSession: { key: 'session_id', id: sessionId, transcriptPath }
        }
      )
      const tab = state.unifiedTabsByWorktree[worktreeId]?.find(
        (entry) => entry.contentType === 'terminal' && entry.entityId === tabId
      )
      if (!tab) {
        throw new Error('Chat tab unavailable')
      }
      state.toggleTabViewMode(tab.id)
    },
    { ...descriptor, tabId, sessionId, transcriptPath }
  )
  const menu = orcaPage.locator('[data-native-chat-context-menu]')
  for (const [label, path] of [
    ['Ordinary file', ordinary],
    ['Escaped file', spaced]
  ]) {
    await orcaPage.getByRole('link', { name: label, exact: true }).click({ button: 'right' })
    await menu.getByRole('menuitem', { name: 'Reveal in File Explorer', exact: true }).click()
    await expect
      .poll(() => electronApp.evaluate(() => process.env.ORCA_E2E_REVEALED_PATH))
      .toBe(normalize(path))
    await electronApp.evaluate(() => {
      delete process.env.ORCA_E2E_REVEALED_PATH
    })
  }
  await orcaPage.getByRole('link', { name: 'Missing file', exact: true }).click({ button: 'right' })
  await menu.getByRole('menuitem', { name: 'Reveal in File Explorer', exact: true }).click()
  await expect(
    orcaPage.getByText('File not found. It may have been moved or deleted.', { exact: true })
  ).toBeVisible()
  expect(await electronApp.evaluate(() => process.env.ORCA_E2E_REVEALED_PATH)).toBeUndefined()
  await orcaPage.screenshot({ path: testInfo.outputPath('chat-file-reveal.png') })
})
