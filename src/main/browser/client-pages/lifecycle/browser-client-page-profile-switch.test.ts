import { BrowserClientUploadStaging } from '../../client-hosts/file-transfers/browser-client-upload-staging'
import type { BrowserClientPageRendererIdentity } from '../../../../shared/browser/client-hosting/browser-client-page-renderer-protocol'
import { BrowserRoutePageAvailability } from '../../routing/guest-authority/browser-route-page-availability'
import { describe, expect, it, vi } from 'vitest'
import {
  createCommand,
  createHarness,
  createLifecycleClaim
} from '../execution/browser-client-page-command-executor-test-harness'
import type { BrowserClientHostCommandEvent } from '../../../../shared/browser/client-hosting/browser-client-host-protocol'

const switchCommand = (): BrowserClientHostCommandEvent =>
  createCommand('navigate', {
    pageReconciliationProtocolVersion: 1,
    command: {
      type: 'switchProfile',
      nextPageHostGeneration: 8,
      profile: {
        id: 'remote-isolated',
        label: 'Remote profile',
        scope: 'isolated'
      }
    }
  })

async function fixture(
  availability?: BrowserRoutePageAvailability,
  oldGuestIsCurrent?: () => boolean
) {
  const harness = createHarness()
  if (oldGuestIsCurrent) {
    harness.dependencies.routeWebContents.claimGuestLifecycle.mockImplementationOnce(
      (registration) => createLifecycleClaim(registration, Promise.resolve(), oldGuestIsCurrent)
    )
  }
  if (availability) {
    Object.assign(harness.dependencies.routeWebContents, {
      watchPageAvailability: availability.watch
    })
  }
  const bindReplacement = vi.fn()
  Object.assign(harness.dependencies.guestBinding, { bindReplacement })
  await harness.executor.handle(createCommand('createPage'), new AbortController().signal)
  harness.dependencies.routeSessions.preparePage.mockResolvedValue({
    partition: `persist:orca-browser-v1-${'b'.repeat(64)}`,
    release: vi.fn()
  })
  harness.renderer.mountPage.mockResolvedValue({ webContentsId: 42 })
  harness.order.length = 0
  return { ...harness, bindReplacement }
}

describe('staged client page profile switching', () => {
  it('finishes independent pages, retained profile cleanup and uploads after one initializer cleanup fails', async () => {
    const h = await fixture()
    const signal = new AbortController().signal
    h.renderer.retirePage.mockRejectedValueOnce(new Error('old-profile-retirement'))
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const removeDirectory = vi.fn(async () => {})
    const uploads = new BrowserClientUploadStaging('/virtual/pr41490-uploads', {
      mkdir: async () => {},
      writeFile: async () => {},
      removeDirectory,
      removeDirectorySync: () => {}
    })
    Object.assign(h.dependencies, { uploadStaging: uploads })
    try {
      expect(await h.executor.handle(switchCommand(), signal)).toMatchObject({
        status: 'completed'
      })
      for (const [index, id] of ['initializer-first', 'initializer-second'].entries()) {
        expect(
          await h.executor.handle(
            createCommand('createPage', {
              browserPageId: id,
              pageHostGeneration: 9 + index,
              command: {
                type: 'createPage',
                browserProfileId: 'remote-isolated',
                executionHostKey: 'execution-host-a',
                initialUrl: 'https://example.internal/held'
              }
            }),
            signal
          )
        ).toMatchObject({ status: 'completed' })
      }
      await uploads.stage({
        browserPageId: 'independent-upload',
        pageHostGeneration: 1,
        files: [{ remotePath: 'proof.txt', contents: Buffer.from('proof') }]
      })
      const retired: string[] = []
      Object.assign(h.renderer, {
        retirePage: vi.fn(async (page: BrowserClientPageRendererIdentity) => {
          retired.push(`${page.browserPageId}:${page.pageHostGeneration}`)
          if (page.browserPageId === 'initializer-first') {
            throw new Error('first-cleanup-failed')
          }
        })
      })
      await expect(h.executor.close()).rejects.toThrow(
        'Browser client page executor cleanup failed'
      )
      expect(retired).toEqual([
        'initializer-first:9',
        'initializer-second:10',
        'page-a:7',
        'page-a:8'
      ])
      expect(removeDirectory).toHaveBeenCalledOnce()
      await expect(h.executor.close()).rejects.toThrow(
        'Browser client page executor cleanup failed'
      )
      expect(retired).toHaveLength(4)
    } finally {
      warning.mockRestore()
    }
  })

  it('restores the old guest when replacement navigation fails', async () => {
    const h = await fixture()
    await h.executor.handle(
      createCommand('navigate', {
        command: { type: 'navigate', url: 'https://example.com/authenticated' }
      }),
      new AbortController().signal
    )
    h.dependencies.routeWebContents.navigateGuest.mockResolvedValueOnce(false)
    expect(await h.executor.handle(switchCommand(), new AbortController().signal)).toMatchObject({
      status: 'failed'
    })
    expect(h.executor.hasPage('page-a', 7)).toBe(true)
    expect(h.executor.snapshotPageInventory()).toMatchObject([
      {
        browserProfileId: 'profile-a',
        currentUrl: 'https://example.com/authenticated',
        state: 'active'
      }
    ])
    expect(h.dependencies.guestBinding.bind).toHaveBeenLastCalledWith(
      expect.objectContaining({
        registration: expect.objectContaining({ webContentsId: 41 })
      })
    )
    const binding = h.dependencies.guestBinding
    const stagedRelease = binding.release.mock.calls.findIndex(
      ([registration]) => registration.webContentsId === 42
    )
    expect(binding.bind.mock.invocationCallOrder.at(-1)).toBeLessThan(
      binding.release.mock.invocationCallOrder[stagedRelease]!
    )
  })

  it('keeps the new availability watcher after retiring the old generation', async () => {
    const availability = new BrowserRoutePageAvailability()
    const h = await fixture(availability)
    expect(await h.executor.handle(switchCommand(), new AbortController().signal)).toMatchObject({
      status: 'completed'
    })
    availability.report(h.dependencies.routeWebContents.claimGuestLifecycle.mock.calls[0]![0])
    expect(h.executor.snapshotPageInventory()).toMatchObject([
      { state: 'active', pageHostGeneration: 8 }
    ])
    availability.report(h.dependencies.routeWebContents.claimGuestLifecycle.mock.calls.at(-1)![0])
    expect(h.executor.snapshotPageInventory()).toMatchObject([
      { state: 'outcomeUnknown', pageHostGeneration: 8 }
    ])
  })
  // PR33112: a profile switch must mount its replacement through the page's own renderer,
  // not whichever desktop window the shared selector would currently pick.
  it('mounts the replacement through the owning renderer even when another window is focused', async () => {
    const h = await fixture()
    // Simulate focus moving to a second window between page creation and the profile switch.
    h.dependencies.selectRenderer.mockReturnValue(h.focusedRenderer)

    expect(await h.executor.handle(switchCommand(), new AbortController().signal)).toEqual({
      status: 'completed'
    })

    expect(h.renderer.mountPage).toHaveBeenCalledTimes(2)
    expect(h.focusedRenderer.mountPage).not.toHaveBeenCalled()
    expect(h.bindReplacement).toHaveBeenCalledWith(
      expect.objectContaining({
        registration: expect.objectContaining({
          webContentsId: 42,
          rendererWebContentsId: h.renderer.rendererWebContentsId
        })
      })
    )
  })

  // The same pin must hold through rollback: a bind failure restores the old guest on its own renderer.
  it('restores the old guest on its own renderer when binding fails while another window is focused', async () => {
    const h = await fixture()
    h.dependencies.selectRenderer.mockReturnValue(h.focusedRenderer)
    h.bindReplacement.mockImplementation(() => {
      throw new Error('bind failed')
    })

    expect(await h.executor.handle(switchCommand(), new AbortController().signal)).toMatchObject({
      status: 'failed'
    })

    expect(h.executor.hasPage('page-a', 7)).toBe(true)
    expect(h.focusedRenderer.mountPage).not.toHaveBeenCalled()
    expect(h.focusedRenderer.retirePage).not.toHaveBeenCalled()
    expect(h.renderer.retirePage).toHaveBeenCalledWith(
      expect.objectContaining({ browserPageId: 'page-a', pageHostGeneration: 8 })
    )
    expect(h.dependencies.guestBinding.bind).toHaveBeenLastCalledWith(
      expect.objectContaining({
        registration: expect.objectContaining({ webContentsId: 41 }),
        browserProfileId: 'profile-a'
      })
    )
  })
})
