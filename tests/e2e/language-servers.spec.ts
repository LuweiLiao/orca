import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'

function hasProgram(program: string): boolean {
  try {
    execFileSync(program, ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const MAIN_C = [
  '#include "math.h"',
  '',
  'int main(void) {',
  '  int total = add(2, 3);',
  '  char *wrong = total;',
  '  return total + add(total, 1);',
  '}',
  ''
].join('\n')

async function openSource(
  page: Page,
  filePath: string,
  relativePath: string,
  language = 'c'
): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        ({ filePath, relativePath, language }) => {
          const state = window.__store?.getState()
          if (!state?.activeWorktreeId) {
            return false
          }
          const file = state.openFiles.find((candidate) => candidate.filePath === filePath)
          if (!file) {
            state.openFile({
              filePath,
              relativePath,
              worktreeId: state.activeWorktreeId,
              language,
              mode: 'edit'
            })
            return false
          }
          // Why: a terminal that finishes starting can take the front; bring the file back.
          if (state.activeFileId !== file.id || state.activeTabType !== 'editor') {
            state.setActiveFile(file.id)
            state.setActiveTabType('editor', state.activeWorktreeId)
            return false
          }
          return true
        },
        { filePath, relativePath, language }
      )
    )
    .toBe(true)
}

function activeFilePath(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const state = window.__store?.getState()
    return state?.openFiles.find((file) => file.id === state.activeFileId)?.filePath ?? null
  })
}

test('clangd answers diagnostics, hover, completion, definition and references', async ({
  orcaPage,
  seededRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  test.skip(!hasProgram('clangd'), 'clangd is not installed')
  const dir = path.join(seededRepoPath, 'clang-demo')
  const buildDir = path.join(dir, 'build', 'demo')
  mkdirSync(buildDir, { recursive: true })
  writeFileSync(
    path.join(dir, 'math.h'),
    '#pragma once\n/** Adds two numbers. */\nint add(int a, int b);\n'
  )
  writeFileSync(
    path.join(dir, 'math.c'),
    '#include "math.h"\n\nint add(int a, int b) {\n  return a + b;\n}\n'
  )
  writeFileSync(path.join(dir, 'main.c'), MAIN_C)
  // Why under build/<target>/: firmware trees keep one database per target, which clangd misses.
  writeFileSync(
    path.join(buildDir, 'compile_commands.json'),
    JSON.stringify(
      ['main.c', 'math.c'].map((file) => ({
        directory: seededRepoPath,
        file: path.join(dir, file),
        arguments: ['cc', '-c', `-I${dir}`, path.join(dir, file)]
      }))
    )
  )
  registerPostElectronShutdownCleanup(async () => rmSync(dir, { recursive: true, force: true }))

  await openSource(orcaPage, path.join(dir, 'main.c'), 'clang-demo/main.c')
  const editor = orcaPage.locator('.monaco-editor').filter({ hasText: 'int main' }).first()
  await expect(editor).toBeVisible()

  // Diagnostics: assigning an int to a char* is flagged where it happens.
  await expect(editor.locator('.squiggly-error, .squiggly-warning').first()).toBeVisible({
    timeout: 30_000
  })
  await orcaPage.screenshot({
    path: testInfo.outputPath('1-diagnostics.png'),
    animations: 'disabled'
  })

  // Hover: the declaration's signature and doc comment (Ctrl+K Ctrl+I shows it at the cursor).
  const toAddCall = async (): Promise<void> => {
    await editor.locator('.view-line').filter({ hasText: 'int total = add' }).click()
    await orcaPage.keyboard.press('Home')
    // Home lands on `int`; `int total = ` is 12 characters before `add`.
    for (let step = 0; step < 13; step += 1) {
      await orcaPage.keyboard.press('ArrowRight')
    }
  }
  await toAddCall()
  await orcaPage.keyboard.press('Control+k')
  await orcaPage.keyboard.press('Control+i')
  await expect(
    orcaPage.locator('.monaco-hover').filter({ hasText: 'Adds two numbers' })
  ).toBeVisible({
    timeout: 15_000
  })
  await orcaPage.keyboard.press('Escape')

  // Completion: typing a prefix offers the project's function.
  await editor.locator('.view-line').filter({ hasText: 'return total' }).click()
  await orcaPage.keyboard.press('End')
  await orcaPage.keyboard.press('Enter')
  await orcaPage.keyboard.type('ad')
  await orcaPage.keyboard.press('Control+Space')
  await expect(
    orcaPage.locator('.suggest-widget .monaco-list-row').filter({ hasText: 'add' }).first()
  ).toBeVisible({
    timeout: 15_000
  })
  await orcaPage.screenshot({
    path: testInfo.outputPath('2-completion.png'),
    animations: 'disabled'
  })
  await orcaPage.keyboard.press('Escape')
  await orcaPage.keyboard.press('Control+z')
  await orcaPage.keyboard.press('Control+z')

  // References: Shift+F12 lists both calls and the declarations in a Peek.
  await toAddCall()
  await orcaPage.keyboard.press('Shift+F12')
  const peek = orcaPage.locator('.zone-widget .peekview-widget, .reference-zone-widget').first()
  await expect(peek).toBeVisible({ timeout: 15_000 })
  await expect(peek).toContainText('math')
  await orcaPage.screenshot({
    path: testInfo.outputPath('3-references.png'),
    animations: 'disabled'
  })
  await orcaPage.keyboard.press('Escape')

  // Definition in another file: F12 opens it in an Orca tab.
  await toAddCall()
  await orcaPage.keyboard.press('F12')
  await expect
    .poll(() => activeFilePath(orcaPage), { timeout: 15_000 })
    .toMatch(/clang-demo\/math\.[ch]$/)
  await orcaPage.screenshot({
    path: testInfo.outputPath('4-definition.png'),
    animations: 'disabled'
  })
})

// rust-analyzer is a rustup proxy that needs the real HOME, which E2E isolates; it is checked
// on a real project after install instead.
const OTHER_SERVERS = [
  {
    name: 'pyright',
    // Why the CLI: the server binary exits non-zero on --version.
    program: 'pyright',
    language: 'python',
    dir: 'py-demo',
    file: 'main.py',
    files: {
      'helpers.py':
        'def greet(name: str) -> str:\n    """Says hello."""\n    return "hi " + name\n',
      'main.py': 'from helpers import greet\n\nmessage: int = greet("x")\n'
    },
    line: 'message: int = greet',
    definition: /py-demo\/helpers\.py$/
  },
  {
    name: 'typescript-language-server',
    program: 'typescript-language-server',
    language: 'typescript',
    dir: 'ts-demo',
    file: 'main.ts',
    files: {
      'tsconfig.json':
        '{ "compilerOptions": { "strict": true, "module": "esnext", "target": "es2022" } }\n',
      'helpers.ts':
        '/** Says hello. */\nexport function greet(name: string): string {\n  return `hi ${name}`\n}\n',
      'main.ts':
        "import { greet } from './helpers'\n\nconst message: number = greet('x')\nconsole.log(message)\n"
    },
    line: 'const message: number = greet',
    definition: /ts-demo\/helpers\.ts$/,
    // Why: Monaco's own TS service must step aside, or every hover and completion shows twice.
    ownedLanguage: 'orca-lsp-typescript'
  }
] as const

for (const server of OTHER_SERVERS) {
  test(`${server.name} answers diagnostics and jumps to a definition in another file`, async ({
    orcaPage,
    seededRepoPath,
    registerPostElectronShutdownCleanup
  }, testInfo) => {
    test.skip(!hasProgram(server.program), `${server.program} is not installed`)
    const dir = path.join(seededRepoPath, server.dir)
    for (const [name, text] of Object.entries(server.files)) {
      mkdirSync(path.dirname(path.join(dir, name)), { recursive: true })
      writeFileSync(path.join(dir, name), text)
    }
    registerPostElectronShutdownCleanup(async () => rmSync(dir, { recursive: true, force: true }))
    await openSource(
      orcaPage,
      path.join(dir, server.file),
      `${server.dir}/${server.file}`,
      server.language
    )
    const editor = orcaPage.locator('.monaco-editor').filter({ hasText: server.line }).first()
    if ('ownedLanguage' in server) {
      await expect(
        orcaPage.locator(`[data-mode-id="${server.ownedLanguage}"]`).first()
      ).toBeAttached({
        timeout: 60_000
      })
    }
    // A string assigned to a number is a type error every server reports.
    await expect(editor.locator('.squiggly-error').first()).toBeVisible({ timeout: 90_000 })
    await orcaPage.screenshot({
      path: testInfo.outputPath(`${server.name}-diagnostics.png`),
      animations: 'disabled'
    })
    await editor.locator('.view-line').filter({ hasText: server.line }).click()
    await orcaPage.keyboard.press('End')
    // Back over `("x");` / `('x')` onto `greet`.
    const back = server.language === 'typescript' ? 7 : 8
    for (let step = 0; step < back; step += 1) {
      await orcaPage.keyboard.press('ArrowLeft')
    }
    if ('ownedLanguage' in server) {
      // One answer per hover: the built-in service must not add its own copy of the signature.
      await orcaPage.keyboard.press('Control+k')
      await orcaPage.keyboard.press('Control+i')
      const hover = orcaPage.locator('.monaco-hover:not(.hidden)').first()
      await expect(hover).toContainText('Says hello', { timeout: 15_000 })
      await expect(hover.locator('.hover-row').filter({ hasText: 'greet(name' })).toHaveCount(1)
      await orcaPage.keyboard.press('Escape')
    }
    await orcaPage.keyboard.press('F12')
    await expect
      .poll(() => activeFilePath(orcaPage), { timeout: 30_000 })
      .toMatch(server.definition)
  })
}
