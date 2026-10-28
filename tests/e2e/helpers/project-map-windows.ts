import type { Locator } from '@stablyai/playwright-test'
import { expect } from './orca-app'

/** Node windows stay open until their own close button; this closes every one on the map. */
export async function closeProjectMapWindows(map: Locator): Promise<void> {
  const windows = map.locator('[data-project-map-node-window]')
  while ((await windows.count()) > 0) {
    await windows
      .last()
      .locator('header')
      .getByRole('button', { name: 'Close', exact: true })
      .click()
  }
  await expect(windows).toHaveCount(0)
}
