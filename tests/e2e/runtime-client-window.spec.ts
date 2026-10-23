import path from 'node:path'
import type { ElectronApplication, Page, TestInfo } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { attachRepoAndOpenTerminal, createRestartSession } from './helpers/orca-restart'
import { ensureTerminalVisible, waitForSessionReady } from './helpers/store'
import {
  focusActiveTerminalInput,
  waitForActiveTerminalManager,
  waitForTerminalOutput
} from './helpers/terminal'
import { splitMarkerEchoCommand } from './terminal-marker-echo-command'
import { findBundledWebClientRoot } from '../../src/shared/bundled-web-client-root'
import type { PersistedRuntimeClientWindow } from '../../src/shared/persisted-ui-state-types'

const WEB_CLIENT_ENTRY = 'web-index.html'

// Why: extra windows load the runtime-served web client, which a plain electron-vite build lacks.
test.skip(
  !findBundledWebClientRoot(path.join(process.cwd(), 'out', 'main')),
  'Build the web client first (pnpm run build:web-from-renderer after an e2e-mode build)'
)

function isClientPage(page: Page): boolean {
  return !page.isClosed() && page.url().includes(WEB_CLIENT_ENTRY)
}

function isMainPage(page: Page): boolean {
  return !page.isClosed() && /\/index\.html(?:[?#]|$)/.test(page.url())
}

async function openClientWindow(
  app: ElectronApplication,
  hostPage: Page,
  worktreeId?: string
): Promise<Page> {
  const known = new Set(app.windows())
  const result = await hostPage.evaluate(
    (id) => window.api.ui.openRuntimeClientWindow(id ? { worktreeId: id } : undefined),
    worktreeId
  )
  expect(result).toEqual({ ok: true })
  return waitForNewClientPage(app, known)
}

async function waitForNewClientPage(
  app: ElectronApplication,
  known: ReadonlySet<Page>
): Promise<Page> {
  let found: Page | null = null
  await expect
    .poll(
      () => {
        found = app.windows().find((page) => !known.has(page) && isClientPage(page)) ?? null
        return found !== null
      },
      { timeout: 30_000, message: 'No new web client window appeared' }
    )
    .toBe(true)
  if (!found) {
    throw new Error('Web client window disappeared after it appeared')
  }
  return found
}

async function waitForMainPage(app: ElectronApplication): Promise<Page> {
  let found: Page | null = null
  await expect
    .poll(
      () => {
        found = app.windows().find(isMainPage) ?? null
        return found !== null
      },
      { timeout: 30_000, message: 'Main window did not appear' }
    )
    .toBe(true)
  if (!found) {
    throw new Error('Main window disappeared after it appeared')
  }
  await found.waitForFunction(() => Boolean(window.__store), null, { timeout: 30_000 })
  return found
}

/** The paired Orca shell, not the pairing or connection-error page. */
async function expectPairedWorkspaceShell(page: Page): Promise<void> {
  await expect(page.locator('[data-worktree-sidebar]')).toBeVisible({ timeout: 60_000 })
  // Why: terminal assertions read the exposed store, which only an e2e-mode web build has.
  expect(
    await page.evaluate(() => Boolean(window.__store)),
    'web client was projected from a renderer built without VITE_EXPOSE_STORE'
  ).toBe(true)
}

async function expectRenderedWorktree(page: Page, worktreeId: string): Promise<void> {
  await expect(page.locator('[data-rendered-active-worktree-id]')).toHaveAttribute(
    'data-rendered-active-worktree-id',
    worktreeId,
    { timeout: 30_000 }
  )
}

async function runMarkerInActiveTerminal(
  page: Page,
  prefix: string,
  suffix: string
): Promise<void> {
  await ensureTerminalVisible(page, 30_000)
  await waitForActiveTerminalManager(page, 30_000)
  await focusActiveTerminalInput(page)
  await page.keyboard.type(splitMarkerEchoCommand(prefix, suffix))
  await page.keyboard.press('Enter')
  await waitForTerminalOutput(page, `${prefix}${suffix}`, 30_000)
}

async function readClientWindowRecords(hostPage: Page): Promise<PersistedRuntimeClientWindow[]> {
  return hostPage.evaluate(async () => (await window.api.ui.get()).runtimeClientWindows ?? [])
}

/** Closes a slot's window the way its title-bar close does, from the main process. */
async function closeClientWindowSlot(app: ElectronApplication, slot: number): Promise<void> {
  const closed = await app.evaluate(({ BrowserWindow }, partitionDir) => {
    const target = BrowserWindow.getAllWindows().find((candidate) =>
      candidate.webContents.session.storagePath?.endsWith(partitionDir)
    )
    target?.close()
    return Boolean(target)
  }, `orca-client-window-${slot}`)
  expect(closed).toBe(true)
}

async function saveScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const screenshotPath = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path: screenshotPath })
  await testInfo.attach(name, { path: screenshotPath, contentType: 'image/png' })
}

async function readWorkspaceIds(hostPage: Page): Promise<{ a: string; b: string }> {
  const ids = await hostPage.evaluate(() => {
    const state = window.__store?.getState()
    const active = state?.activeWorktreeId
    const other = state
      ?.allWorktrees()
      .find((worktree) => worktree.branch === 'refs/heads/e2e-secondary')
    return active && other ? { a: active, b: other.id } : null
  })
  if (!ids || ids.a === ids.b) {
    throw new Error(`Expected the seeded primary and secondary workspaces, got ${String(ids)}`)
  }
  return ids
}

test('extra windows pair, open on their own workspace, and close without disturbing the main window', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(240_000)
  const { a, b } = await readWorkspaceIds(orcaPage)
  await expectRenderedWorktree(orcaPage, a)

  const plain = await openClientWindow(electronApp, orcaPage)
  await expectPairedWorkspaceShell(plain)
  await saveScreenshot(plain, testInfo, 'runtime-client-window-paired')

  const onB = await openClientWindow(electronApp, orcaPage, b)
  await expectPairedWorkspaceShell(onB)
  await expectRenderedWorktree(onB, b)
  await saveScreenshot(onB, testInfo, 'runtime-client-window-workspace-b')
  await expectRenderedWorktree(orcaPage, a)
  expect(await orcaPage.evaluate(() => window.__store?.getState().activeWorktreeId)).toBe(a)

  await runMarkerInActiveTerminal(onB, 'orca-window-', 'b')
  await expectRenderedWorktree(onB, b)
  await runMarkerInActiveTerminal(orcaPage, 'orca-window-', 'a')
  await expectRenderedWorktree(orcaPage, a)

  expect(await readClientWindowRecords(orcaPage)).toMatchObject([
    { slot: 1, open: true },
    { slot: 2, open: true }
  ])
  await closeClientWindowSlot(electronApp, 2)
  await expect.poll(() => onB.isClosed(), { timeout: 15_000 }).toBe(true)
  expect(plain.isClosed()).toBe(false)
  await expect
    .poll(async () =>
      (await readClientWindowRecords(orcaPage)).map(({ slot, open }) => ({ slot, open }))
    )
    .toEqual([
      { slot: 1, open: true },
      { slot: 2, open: false }
    ])
  await runMarkerInActiveTerminal(orcaPage, 'orca-window-a-', 'after-close')

  // Reopening the closed slot reconnects from its stored pairing instead of minting a device.
  const slot2Before = (await readClientWindowRecords(orcaPage)).find(({ slot }) => slot === 2)
  expect(slot2Before?.deviceId).toBeTruthy()
  const reopened = await openClientWindow(electronApp, orcaPage, b)
  await expectPairedWorkspaceShell(reopened)
  await expectRenderedWorktree(reopened, b)
  const slot2After = (await readClientWindowRecords(orcaPage)).find(({ slot }) => slot === 2)
  expect(slot2After).toMatchObject({ open: true, deviceId: slot2Before?.deviceId })
})

test('reopens the extra windows that were open when the app quit', async ({
  testRepoPath
}, testInfo) => {
  test.setTimeout(300_000)
  const session = createRestartSession(testInfo)
  let firstApp: ElectronApplication | null = null
  let secondApp: ElectronApplication | null = null
  try {
    const first = await session.launch()
    firstApp = first.app
    await waitForSessionReady(first.page)
    await attachRepoAndOpenTerminal(first.page, testRepoPath)
    const client = await openClientWindow(first.app, first.page)
    await expectPairedWorkspaceShell(client)
    const [record] = await readClientWindowRecords(first.page)
    expect(record).toMatchObject({ slot: 1, open: true })
    expect(record?.deviceId).toBeTruthy()

    await session.close(first.app)
    firstApp = null

    const second = await session.launch()
    secondApp = second.app
    // Why: the restored window can attach before the main one, so firstWindow() may be either.
    const restored = await waitForNewClientPage(second.app, new Set())
    const mainPage = await waitForMainPage(second.app)
    await waitForSessionReady(mainPage)
    await expectPairedWorkspaceShell(restored)
    await saveScreenshot(restored, testInfo, 'runtime-client-window-restored')
    expect(await readClientWindowRecords(mainPage)).toMatchObject([
      { slot: 1, open: true, deviceId: record?.deviceId }
    ])
  } finally {
    for (const app of [secondApp, firstApp]) {
      if (app) {
        await session.close(app).catch(() => undefined)
      }
    }
    await session.dispose()
  }
})
