import { chmodSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveCommandOnLocalPath } from '../ipc/command-path/command-path-resolver'
import {
  compilerDrivers,
  findCompilationDatabase,
  languageServerLaunch
} from './language-server-catalog'

vi.mock('../ipc/command-path/command-path-resolver', () => ({
  resolveCommandOnLocalPath: vi.fn()
}))

const dirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'orca-lsp-catalog-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('clangd launch', () => {
  it('picks the newest build/<target> database and asks only outside compilers for headers', async () => {
    const root = tempDir()
    const toolchain = path.join(tempDir(), 'arm-none-eabi-g++')
    const shipped = path.join(root, 'tools', 'cc')
    for (const program of [toolchain, shipped]) {
      mkdirSync(path.dirname(program), { recursive: true })
      writeFileSync(program, '#!/bin/sh\n')
      chmodSync(program, 0o755)
    }
    for (const [target, age] of [
      ['old', 100],
      ['new', 10]
    ] as const) {
      mkdirSync(path.join(root, 'build', target), { recursive: true })
      const file = path.join(root, 'build', target, 'compile_commands.json')
      writeFileSync(
        file,
        JSON.stringify([
          { file: 'a.c', arguments: [toolchain, '-c', 'a.c'] },
          { file: 'b.c', command: `${shipped} -c b.c` },
          { file: 'c.c', command: '../../tools/cc -c c.c' }
        ])
      )
      const seconds = Date.now() / 1000 - age
      utimesSync(file, seconds, seconds)
    }
    const database = await findCompilationDatabase(root)
    expect(database).toEqual({
      file: path.join(root, 'build', 'new', 'compile_commands.json'),
      nested: true
    })
    expect(await compilerDrivers(database?.file ?? '', root)).toEqual([toolchain])
  })

  it('lets clangd find a top-level database itself', async () => {
    const root = tempDir()
    mkdirSync(path.join(root, 'build'))
    writeFileSync(path.join(root, 'build', 'compile_commands.json'), '[]')
    expect(await findCompilationDatabase(root)).toEqual({
      file: path.join(root, 'build', 'compile_commands.json'),
      nested: false
    })
  })
})

describe('typescript launch', () => {
  it('finds the tsserver behind a Windows npm tsc.cmd shim', async () => {
    const prefix = tempDir()
    const typescript = path.join(prefix, 'node_modules', 'typescript')
    mkdirSync(path.join(typescript, 'bin'), { recursive: true })
    mkdirSync(path.join(typescript, 'lib'), { recursive: true })
    writeFileSync(path.join(typescript, 'bin', 'tsc'), '')
    writeFileSync(path.join(typescript, 'lib', 'tsserver.js'), '')
    const shim = path.join(prefix, 'tsc.cmd')
    writeFileSync(
      shim,
      [
        '@ECHO off',
        'GOTO start',
        ':find_dp0',
        'SET dp0=%~dp0',
        'EXIT /b',
        ':start',
        'SETLOCAL',
        'CALL :find_dp0',
        '',
        'IF EXIST "%dp0%\\node.exe" (',
        '  SET "_prog=%dp0%\\node.exe"',
        ') ELSE (',
        '  SET "_prog=node"',
        '  SET PATHEXT=%PATHEXT:;.JS;=;%',
        ')',
        '',
        'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\typescript\\bin\\tsc" %*',
        ''
      ].join('\r\n')
    )
    vi.mocked(resolveCommandOnLocalPath).mockResolvedValue(shim)
    const launch = await languageServerLaunch('typescript', tempDir())
    expect(launch.initializationOptions).toEqual({
      tsserver: { path: path.join(typescript, 'lib', 'tsserver.js') }
    })
  })
})
