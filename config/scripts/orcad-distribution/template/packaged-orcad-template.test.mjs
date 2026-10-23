import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runProcessSync } from '@orca/process-host'
import { ORCAD_TEMPLATE_MANIFEST_FILENAME } from '../../../../src/shared/remote-runtime/orcad-distribution/orcad-artifacts.ts'
import { writeOrcadTemplateTestFixture } from './orcad-template-test-fixture.mjs'

const require = createRequire(import.meta.url)
const {
  assertOrcadTemplateBuilt,
  resealOrcadTemplateManifest
} = require('./packaged-orcad-template.cjs')

const roots = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const quietly = () => vi.spyOn(console, 'log').mockImplementation(() => {})

async function createProjectBuild() {
  const projectDir = await mkdtemp(join(tmpdir(), 'orca-packaged-orcad-'))
  roots.push(projectDir)
  const outDir = join(projectDir, 'out')
  await mkdir(outDir)
  const templateDir = await writeOrcadTemplateTestFixture(outDir)
  const identity = { type: 'commonjs', commit: 'a'.repeat(40) }
  await writeFile(join(outDir, 'package.json'), JSON.stringify(identity))
  await writeFile(join(templateDir, 'out', 'package.json'), JSON.stringify(identity))
  resealOrcadTemplateManifest(templateDir, ['out/package.json'])
  return { projectDir, templateDir }
}

async function stampTemplateCommit(templateDir, commit) {
  await writeFile(join(templateDir, 'out', 'package.json'), JSON.stringify({ commit }))
  resealOrcadTemplateManifest(templateDir, ['out/package.json'])
}

describe('orcad template before packaging', () => {
  it('exposes a command that accepts a matching build and rejects an older template', async () => {
    const { projectDir, templateDir } = await createProjectBuild()
    const verify = () =>
      runProcessSync({
        program: process.env.ORCA_TEST_NODE_EXECUTABLE ?? process.execPath,
        args: [
          join(import.meta.dirname, 'packaged-orcad-template.cjs'),
          '--verify-build',
          projectDir
        ],
        cwd: projectDir,
        env: { ...process.env, ORCA_BACKGROUND_LAUNCH: '1' }
      })
    const matching = verify()
    expect(matching.code, matching.stderr).toBe(0)
    await stampTemplateCommit(templateDir, 'b'.repeat(40))
    const mismatched = verify()
    expect(mismatched.code).not.toBe(0)
    expect(mismatched.stderr).toContain('source commit')
  })

  it('accepts channel-specific app versions when the source commit matches', async () => {
    quietly()
    const { projectDir } = await createProjectBuild()
    await writeFile(
      join(projectDir, 'out', 'package.json'),
      JSON.stringify({ commit: 'a'.repeat(40), version: '1.4.214-dev.1' })
    )
    expect(() => assertOrcadTemplateBuilt(projectDir)).not.toThrow()
  })

  it.each(['desktop', 'template'])('rejects a missing %s source commit', async (kind) => {
    const { projectDir, templateDir } = await createProjectBuild()
    const packagePath =
      kind === 'desktop'
        ? join(projectDir, 'out', 'package.json')
        : join(templateDir, 'out', 'package.json')
    await writeFile(packagePath, JSON.stringify({ type: 'commonjs' }))
    if (kind === 'template') {
      resealOrcadTemplateManifest(templateDir, ['out/package.json'])
    }
    expect(() => assertOrcadTemplateBuilt(projectDir)).toThrow(
      'does not identify its source commit'
    )
  })

  it('rejects a template missing a required child before packaging starts', async () => {
    const { projectDir, templateDir } = await createProjectBuild()
    const manifestPath = join(templateDir, ORCAD_TEMPLATE_MANIFEST_FILENAME)
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    delete manifest.commonSha256['computer-sidecar.js']
    await writeFile(manifestPath, JSON.stringify(manifest))
    await rm(join(templateDir, 'computer-sidecar.js'))
    expect(() => assertOrcadTemplateBuilt(projectDir)).toThrow('common manifest inventory')
  })
})
