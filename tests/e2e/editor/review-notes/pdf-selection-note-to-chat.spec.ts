import { randomUUID } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from '../../desktop/electron-fixtures/orca-app'
import { expect } from '@stablyai/playwright-test'
import {
  ensureTerminalVisible,
  waitForActiveWorktree,
  waitForSessionReady
} from '../../desktop/renderer-probes/store'
import { waitForActivePaneHookDescriptor } from '../../terminal/input/terminal-active-pane'
import { waitForActiveTerminalManager } from '../../terminal/layout/terminal-pane-operations'
import { claudeTranscriptLines } from '../../agents/session-fixtures/native-chat-transcript-fixture'
import { createPdfFindFixture } from '../pdf/pdf-find-fixture'

test('a note on selected PDF text goes, unsent, to the chat used last', async ({
  orcaPage,
  seededRepoPath
}, testInfo) => {
  await waitForSessionReady(orcaPage)
  await orcaPage.setViewportSize({ width: 1280, height: 900 })
  const worktreeId = await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)
  await waitForActiveTerminalManager(orcaPage, 30_000)
  const descriptor = await waitForActivePaneHookDescriptor(orcaPage)
  const [terminalTabId] = descriptor.paneKey.split(':')
  const sessionId = `e2e-pdf-note-${randomUUID()}`
  const transcriptPath = path.join(
    mkdtempSync(path.join(tmpdir(), 'orca-pdf-note-transcript-')),
    `${sessionId}.jsonl`
  )
  writeFileSync(
    transcriptPath,
    claudeTranscriptLines({
      sessionId,
      userText: 'Review the paper with me.',
      assistantText: 'Send me the passages you want changed.'
    })
  )
  const pdfPath = path.join(seededRepoPath, 'paper.pdf')
  writeFileSync(pdfPath, createPdfFindFixture())

  // The terminal becomes a Claude chat, the one chat this workspace has used.
  await orcaPage.evaluate(
    async ({ paneKey, worktreeId, sessionId, transcriptPath, terminalTabId }) => {
      const store = window.__store
      if (!store) {
        throw new Error('Store unavailable')
      }
      await store.getState().updateSettingsOrThrow({
        uiLanguage: 'en',
        claudeCodeThemeSyncOffer: 'settled'
      })
      const state = store.getState()
      state.setAgentStatus(
        paneKey,
        { state: 'done', agentType: 'claude', prompt: 'paper review' },
        'Claude',
        undefined,
        { worktreeId },
        { providerSession: { key: 'session_id', id: sessionId, transcriptPath } }
      )
      const tab = state.unifiedTabsByWorktree[worktreeId]?.find(
        (candidate) => candidate.contentType === 'terminal' && candidate.entityId === terminalTabId
      )
      if (!tab) {
        throw new Error('Terminal unavailable')
      }
      state.toggleTabViewMode(tab.id)
    },
    { ...descriptor, worktreeId, sessionId, transcriptPath, terminalTabId }
  )
  const chatRoot = orcaPage.locator('[data-native-chat-root="true"]')
  await expect(chatRoot.getByText('Send me the passages you want changed.')).toBeVisible()

  await orcaPage.evaluate(
    ({ worktreeId, pdfPath }) => {
      window.__store?.getState().openFile({
        filePath: pdfPath,
        relativePath: 'paper.pdf',
        worktreeId,
        language: 'plaintext',
        mode: 'edit'
      })
    },
    { worktreeId, pdfPath }
  )
  const firstPage = orcaPage.locator('.pdfViewer .page').first()
  const target = firstPage.locator('.textLayer span', { hasText: 'needle result 1' })
  await expect(target).toBeVisible()
  // Select exactly one text run; a triple click would take the whole text block.
  await target.evaluate((span) => {
    const range = document.createRange()
    range.selectNodeContents(span)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  })
  // A key release settles a keyboard selection, which is when the offer appears.
  await orcaPage.keyboard.press('Shift')
  await orcaPage.getByRole('button', { name: 'Add note', exact: true }).click()

  const composer = orcaPage.locator('[data-pdf-note-composer]')
  await expect(composer).toContainText('needle result 1')
  await composer.getByPlaceholder('Add note for the AI').fill('Reword this result')
  await composer.getByPlaceholder('Add note for the AI').press('Enter')
  await expect(composer).toHaveCount(0)
  await expect(firstPage.locator('[data-pdf-note-badge]')).toHaveText('1')
  await orcaPage.screenshot({ path: testInfo.outputPath('pdf-selection-note.png') })

  const saved = await orcaPage.evaluate((id) => {
    const notes = window.__store?.getState().getDiffComments(id) ?? []
    return notes.map((note) => ({
      source: note.source,
      selectedText: note.selectedText,
      body: note.body,
      sent: typeof note.sentAt === 'number'
    }))
  }, worktreeId)
  expect(saved).toEqual([
    { source: 'pdf', selectedText: 'needle result 1', body: 'Reword this result', sent: true }
  ])

  // The note waits in the chat's composer; nothing was sent to Claude.
  await orcaPage.evaluate(
    ({ worktreeId, terminalTabId }) => {
      const state = window.__store?.getState()
      const tab = state?.unifiedTabsByWorktree[worktreeId]?.find(
        (candidate) => candidate.contentType === 'terminal' && candidate.entityId === terminalTabId
      )
      if (tab) {
        state?.activateTab(tab.id, { worktreeId })
      }
    },
    { worktreeId, terminalTabId }
  )
  const draft = chatRoot.getByRole('textbox').last()
  await expect(draft).toContainText('File: paper.pdf')
  await expect(draft).toContainText('needle result 1')
  await expect(draft).toContainText('Reword this result')
  await orcaPage.screenshot({ path: testInfo.outputPath('chat-draft-with-pdf-note.png') })
})
