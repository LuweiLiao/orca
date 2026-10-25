import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'

test('chat naming uses a model picker and persists its selection', async ({
  orcaPage
}, testInfo) => {
  await waitForSessionReady(orcaPage)
  await orcaPage.evaluate(async () => {
    const store = window.__store
    if (!store) {
      throw new Error('Store unavailable')
    }
    const sourceControlAi = store.getState().settings?.sourceControlAi
    if (!sourceControlAi) {
      throw new Error('Settings unavailable')
    }
    await store.getState().updateSettings({
      uiLanguage: 'en',
      experimentalNativeChat: true,
      defaultTuiAgent: 'codex',
      nativeChatAutoName: true,
      sourceControlAi: {
        ...sourceControlAi,
        actions: {
          conversationName: {
            agentId: 'codex',
            agentArgs: '--model gpt-5.4-mini',
            commandInputTemplate: '{basePrompt}'
          }
        }
      }
    })
    store.getState().openSettingsPage()
  })
  await orcaPage.getByPlaceholder('Search settings').fill('Chat names')
  const section = orcaPage.locator('#chat-names')
  const model = section.getByRole('combobox', { name: 'Model', exact: true })
  await expect(model).toContainText('GPT-5.4 Mini')
  await expect(section.getByText('CLI arguments', { exact: true })).toHaveCount(0)
  await model.click()
  await orcaPage.getByRole('option', { name: 'GPT-5.5', exact: true }).click()
  await section.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(section.getByText('Saved', { exact: true })).toBeVisible()
  await expect(model).toContainText('GPT-5.5')
  await orcaPage.screenshot({ path: testInfo.outputPath('chat-naming-desktop.png') })
  await orcaPage.reload()
  await waitForSessionReady(orcaPage)
  await orcaPage.evaluate(() => window.__store?.getState().openSettingsPage())
  await orcaPage.getByPlaceholder('Search settings').fill('Chat names')
  await expect(model).toContainText('GPT-5.5')
  await orcaPage.setViewportSize({ width: 720, height: 900 })
  await model.click()
  await expect(orcaPage.getByRole('option', { name: 'GPT-5.5', exact: true })).toBeVisible()
  await orcaPage.screenshot({ path: testInfo.outputPath('chat-naming-narrow.png') })
})
