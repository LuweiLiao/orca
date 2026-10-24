import { _electron as electron, expect } from '@stablyai/playwright-test'
import { build as buildMain } from 'esbuild'
import { build as buildRenderer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { PNG } from 'pngjs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

expect(process.env.ORCA_BACKGROUND_LAUNCH).toBe('1')
const root = fileURLToPath(new URL('../../../', import.meta.url))
const parent = path.join(root, '.bench-fixtures')
mkdirSync(parent, { recursive: true })
const output = mkdtempSync(path.join(parent, 'conversation-reference-'))
const main = path.join(output, 'main.cjs')
await buildMain({
  entryPoints: [path.join(root, 'tests/tools/benchmarks/spinner-rendering/main.ts')],
  outfile: main,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron']
})
await buildRenderer({
  configFile: false,
  root: import.meta.dirname,
  base: './',
  logLevel: 'silent',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.join(root, 'src/renderer/src') } },
  build: { outDir: path.join(output, 'renderer'), emptyOutDir: true }
})
const { ELECTRON_RUN_AS_NODE: _node, ...env } = process.env
const app = await electron.launch({
  ...(process.env.ORCA_RENDERED_ELECTRON_PATH
    ? { executablePath: process.env.ORCA_RENDERED_ELECTRON_PATH }
    : {}),
  args: [main],
  env
})
try {
  const page = await app.firstWindow()
  page.setDefaultTimeout(15000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(pathToFileURL(path.join(output, 'renderer/index.html')).href)
  await page.getByTestId('source').dragTo(page.getByRole('textbox'))
  const chip = page.locator('[data-native-chat-conversation-reference]').first()
  await expect(chip).toHaveText('Claude Code conversation')
  const historyTransfer = await page.evaluateHandle(() => new DataTransfer())
  await page.getByTestId('history').dispatchEvent('dragstart', { dataTransfer: historyTransfer })
  const dropBox = await page.getByTestId('composer').boundingBox()
  if (!dropBox) {
    throw new Error('Composer has no rendered drop area')
  }
  await page.getByTestId('resume-overlay').dispatchEvent('drop', {
    dataTransfer: historyTransfer,
    clientX: dropBox.x + dropBox.width / 2,
    clientY: dropBox.y + dropBox.height / 2
  })
  await expect(page.locator('[data-native-chat-conversation-reference]').last()).toHaveText(
    'Cursor history conversation'
  )
  await expect(page.getByTestId('resumed')).toHaveText('0')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByTestId('sent')).toContainText('orca-conversation://reference/')
  await expect(page.getByTestId('sent')).toContainText('orca conversation read')
  await chip.click()
  await expect(page.getByRole('dialog')).toContainText(
    'The earlier conversation contains this source answer.'
  )
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  for (const theme of ['dark', 'light']) {
    await page.evaluate(
      (value) => document.documentElement.classList.toggle('dark', value === 'dark'),
      theme
    )
    for (const width of [1100, 430]) {
      await page.setViewportSize({ width, height: 720 })
      const base64 = await app.evaluate(
        async ({ BrowserWindow }, viewport) => {
          const window = BrowserWindow.getAllWindows()[0]
          window.setSize(viewport.width, viewport.height)
          const image = await window.webContents.capturePage(undefined, {
            stayHidden: true,
            stayAwake: true
          })
          return image.toPNG().toString('base64')
        },
        { width, height: 720 }
      )
      const screenshot = Buffer.from(base64, 'base64')
      writeFileSync(path.join(output, `${theme}-${width}.png`), screenshot)
      const bitmap = PNG.sync.read(screenshot)
      const colors = new Set()
      for (let at = 0; at < bitmap.data.length; at += 16) {
        colors.add(bitmap.data.subarray(at, at + 4).toString('hex'))
      }
      expect(colors.size).toBeGreaterThan(8)
      const dimensions = await page
        .getByTestId('composer')
        .evaluate((element) => ({ width: element.clientWidth, scroll: element.scrollWidth }))
      expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width)
    }
  }
  expect(errors).toEqual([])
  expect(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((window) => [window.isVisible(), window.isFocused()])
    )
  ).toEqual([[false, false]])
  console.log(
    `PASS: drag, reference pill, send instructions, source preview, hidden windows; screenshots: ${output}`
  )
} finally {
  await app.close()
}
