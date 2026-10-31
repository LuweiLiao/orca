import { chmodSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { compilerDrivers, findCompilationDatabase } from './language-server-catalog'

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
