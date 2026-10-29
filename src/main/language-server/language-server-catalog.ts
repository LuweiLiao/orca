import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import type { LanguageServerId } from '../../shared/language-server-types'
import { isDescendantOrEqual } from '../ipc/filesystem-path-containment'
import { resolveCommandOnLocalPath } from '../ipc/command-path-resolver'

export type LanguageServerLaunch = { command: string; args: string[] }

// Why a cap: one database names one or two compilers; dozens means something odd.
const MAX_QUERY_DRIVERS = 8
// Why: a full ArduPilot build database is a few MB; past this, skip driver discovery.
const MAX_DATABASE_BYTES = 64 * 1024 * 1024

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
      const database = await findCompilationDatabase(rootPath)
      const drivers = database ? await compilerDrivers(database.file, rootPath) : []
      return {
        command: 'clangd',
        args: [
          '--background-index',
          // Why: Orca is a reader first; edits that add #includes on completion surprise.
          '--header-insertion=never',
          ...(database?.nested ? [`--compile-commands-dir=${path.dirname(database.file)}`] : []),
          // Why: a cross compiler's own headers (newlib's math.h) are only known by asking it.
          ...(drivers.length ? [`--query-driver=${drivers.join(',')}`] : [])
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
 * clangd finds `compile_commands.json` in the root or `build/` itself (`nested: false`). Firmware
 * trees keep one per target under `build/<target>/`; use the most recently built target.
 */
export async function findCompilationDatabase(
  rootPath: string
): Promise<{ file: string; nested: boolean } | null> {
  for (const direct of [rootPath, path.join(rootPath, 'build')]) {
    const file = path.join(direct, 'compile_commands.json')
    if (await isFile(file)) {
      return { file, nested: false }
    }
  }
  let targets: string[]
  try {
    targets = await readdir(path.join(rootPath, 'build'))
  } catch {
    return null
  }
  let newest: { file: string; mtimeMs: number } | null = null
  for (const target of targets) {
    const file = path.join(rootPath, 'build', target, 'compile_commands.json')
    try {
      const info = await stat(file)
      if (info.isFile() && (!newest || info.mtimeMs > newest.mtimeMs)) {
        newest = { file, mtimeMs: info.mtimeMs }
      }
    } catch {
      // A target without a compilation database.
    }
  }
  return newest ? { file: newest.file, nested: true } : null
}

/**
 * The compilers a database names, for clangd's --query-driver, which runs them to learn their
 * system headers. Why only programs outside the workspace: the database comes with the project,
 * and a cloned repository must not get Orca to run a binary it ships.
 */
export async function compilerDrivers(databaseFile: string, rootPath: string): Promise<string[]> {
  let entries: unknown
  try {
    if ((await stat(databaseFile)).size > MAX_DATABASE_BYTES) {
      return []
    }
    entries = JSON.parse(await readFile(databaseFile, 'utf8'))
  } catch {
    return []
  }
  if (!Array.isArray(entries)) {
    return []
  }
  const names = new Set<string>()
  for (const entry of entries) {
    const args: unknown =
      typeof entry === 'object' && entry ? Reflect.get(entry, 'arguments') : null
    const command: unknown =
      typeof entry === 'object' && entry ? Reflect.get(entry, 'command') : null
    const program = Array.isArray(args)
      ? args[0]
      : typeof command === 'string'
        ? command.trim().split(/\s+/)[0]
        : undefined
    if (typeof program === 'string' && program) {
      names.add(program)
    }
    if (names.size > MAX_QUERY_DRIVERS) {
      return []
    }
  }
  const drivers: string[] = []
  for (const name of names) {
    // Why skip relative paths: they name a program relative to the project, never a toolchain.
    const found = path.isAbsolute(name)
      ? name
      : /[\\/]/.test(name)
        ? null
        : await resolveCommandOnLocalPath(name)
    // Why realpath for the check only: a symlink outside the tree could point back into it, while
    // clangd matches the path as the database spells it.
    const real = found && (await isFile(found)) ? await realpath(found).catch(() => null) : null
    if (
      found &&
      real &&
      !isDescendantOrEqual(real, await realpath(rootPath).catch(() => rootPath))
    ) {
      // A bare name stays a bare-name glob too, since clangd matches the database's spelling.
      drivers.push(...(found === name ? [found] : [name, found]))
    }
  }
  return drivers
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile()
  } catch {
    return false
  }
}
