import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import type { LanguageServerId } from '../../shared/language-server-types'

export type LanguageServerLaunch = { command: string; args: string[] }

/**
 * Builds the command line for a server in `rootPath`. Programs are looked up on the login PATH,
 * so a server installed with a version manager (nvm, rustup) is found as in a terminal.
 */
export async function languageServerLaunch(
  serverId: LanguageServerId,
  rootPath: string
): Promise<LanguageServerLaunch> {
  switch (serverId) {
    case 'clangd': {
      const commandsDir = await findCompileCommandsDir(rootPath)
      return {
        command: 'clangd',
        args: [
          '--background-index',
          // Why: Orca is a reader first; edits that add #includes on completion surprise.
          '--header-insertion=never',
          ...(commandsDir ? [`--compile-commands-dir=${commandsDir}`] : [])
        ]
      }
    }
    case 'pyright':
      return { command: 'pyright-langserver', args: ['--stdio'] }
    case 'rust-analyzer':
      return { command: 'rust-analyzer', args: [] }
    case 'typescript':
      return { command: 'typescript-language-server', args: ['--stdio'] }
  }
}

/**
 * clangd finds `compile_commands.json` in the root or `build/` itself. Firmware trees keep one
 * per target under `build/<target>/`; use the most recently built target.
 */
export async function findCompileCommandsDir(rootPath: string): Promise<string | null> {
  for (const direct of [rootPath, path.join(rootPath, 'build')]) {
    if (await isFile(path.join(direct, 'compile_commands.json'))) {
      return null
    }
  }
  let targets: string[]
  try {
    targets = await readdir(path.join(rootPath, 'build'))
  } catch {
    return null
  }
  let newest: { dir: string; mtimeMs: number } | null = null
  for (const target of targets) {
    const dir = path.join(rootPath, 'build', target)
    try {
      const info = await stat(path.join(dir, 'compile_commands.json'))
      if (info.isFile() && (!newest || info.mtimeMs > newest.mtimeMs)) {
        newest = { dir, mtimeMs: info.mtimeMs }
      }
    } catch {
      // A target without a compilation database.
    }
  }
  return newest?.dir ?? null
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile()
  } catch {
    return false
  }
}
