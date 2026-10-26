import { expect, test } from './helpers/orca-app'

test('dragging tabs into new columns sizes every column equally', async ({
  orcaPage
}, testInfo) => {
  await orcaPage.setViewportSize({ width: 1500, height: 900 })
  await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    const worktreeId = state.activeWorktreeId!
    const tabs = state.tabsByWorktree[worktreeId] ?? []
    for (let index = tabs.length; index < 4; index++) {
      state.createTab(worktreeId)
    }
  })

  const panels = orcaPage.locator('[data-tab-group-body-id]:visible')
  const preview = orcaPage.getByText('New split', { exact: true })
  await expect(orcaPage.locator('[data-testid="sortable-tab"]:visible')).toHaveCount(4)
  await expect(panels).toHaveCount(1)

  // Drags a tab from the first column (which keeps the rest) onto the rightmost column's right edge.
  const splitRightmost = async (columns: number): Promise<void> => {
    const panel = (await panels.last().boundingBox())!
    const tab = (await orcaPage
      .locator('[data-testid="sortable-tab"]:visible')
      .first()
      .boundingBox())!
    await orcaPage.mouse.move(tab.x + tab.width / 2, tab.y + tab.height / 2)
    await orcaPage.mouse.down()
    await orcaPage.mouse.move(panel.x + panel.width - 20, panel.y + panel.height / 2, { steps: 12 })
    await expect(preview).toBeVisible()
    await orcaPage.mouse.up()
    await expect(panels).toHaveCount(columns)
  }
  const widths = async (): Promise<number[]> =>
    Promise.all((await panels.all()).map(async (panel) => (await panel.boundingBox())!.width))
  const expectEven = async (): Promise<void> => {
    await expect
      .poll(async () => {
        const all = await widths()
        return Math.max(...all) - Math.min(...all)
      })
      .toBeLessThan(8)
  }

  await splitRightmost(2)
  await expectEven()
  await splitRightmost(3)
  await expectEven()
  await orcaPage.screenshot({ path: testInfo.outputPath('three-even-columns.png') })
  await splitRightmost(4)
  await expectEven()
  await orcaPage.screenshot({ path: testInfo.outputPath('four-even-columns.png') })

  // Closing a column hands its space to the others in proportion, so they stay even.
  await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    const worktreeId = state.activeWorktreeId!
    const [, second] = state.groupsByWorktree[worktreeId]!
    for (const tabId of second!.tabOrder) {
      state.closeUnifiedTab(tabId)
    }
  })
  await expect(panels).toHaveCount(3)
  await expectEven()
  await orcaPage.screenshot({ path: testInfo.outputPath('after-close-three-even.png') })
})
