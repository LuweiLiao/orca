import { createHash } from 'node:crypto'
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runProcessSync } from '@orca/process-host'
import {
  ORCAD_TEMPLATE_MANIFEST_FILENAME,
  ORCAD_TEMPLATE_TARGETS_DIR
} from '../../src/shared/orcad-artifacts.ts'
import { writeOrcadTemplateTestFixture } from './orcad-template-test-fixture.mjs'

const require = createRequire(import.meta.url)
const {
  assertOrcadTemplateBuilt,
  finalizePackagedOrcadTemplate,
  findOrcadTemplateMachOFiles,
  resealOrcadTemplateManifest,
  resealSignedWindowsApp
} = require('./packaged-orcad-template.cjs')

const PTY = 'node_modules/node-pty/build/Release/pty.node'
const MACH_O_64 = Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 1, 2, 3, 4])
const roots = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), 'orca-packaged-orcad-'))
  roots.push(root)
  return root
}

/** The fixture template, with darwin-arm64's pty.node made a real Mach-O as the build leaves it. */
async function createResources() {
  const resourcesDir = await tempRoot()
  const templateDir = await writeOrcadTemplateTestFixture(resourcesDir)
  const ptyPath = join(templateDir, ORCAD_TEMPLATE_TARGETS_DIR, 'darwin-arm64', ...PTY.split('/'))
  await writeFile(ptyPath, MACH_O_64)
  const manifestPath = join(templateDir, ORCAD_TEMPLATE_MANIFEST_FILENAME)
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.targets['darwin-arm64'].files[PTY] = createHash('sha256').update(MACH_O_64).digest('hex')
  await writeFile(manifestPath, JSON.stringify(manifest))
  return { resourcesDir, templateDir, ptyPath, manifestPath }
}

const quietly = () => vi.spyOn(console, 'log').mockImplementation(() => {})

async function createProjectBuild() {
  const projectDir = await tempRoot()
  const outDir = join(projectDir, 'out')
  await mkdir(outDir)
  const templateDir = await writeOrcadTemplateTestFixture(outDir)
  const identity = { type: 'commonjs', commit: 'a'.repeat(40) }
  await writeFile(join(outDir, 'package.json'), JSON.stringify(identity))
  await writeFile(join(templateDir, 'out', 'package.json'), JSON.stringify(identity))
  resealOrcadTemplateManifest(templateDir, ['out/package.json'])
  return { projectDir, templateDir }
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
    await writeFile(
      join(templateDir, 'out', 'package.json'),
      JSON.stringify({ commit: 'b'.repeat(40) })
    )
    resealOrcadTemplateManifest(templateDir, ['out/package.json'])
    const mismatched = verify()
    expect(mismatched.code).not.toBe(0)
    expect(mismatched.stderr).toContain('source commit')
  })

  it('accepts a verified template built from the compiled desktop source', async () => {
    quietly()
    const { projectDir } = await createProjectBuild()
    expect(() => assertOrcadTemplateBuilt(projectDir)).not.toThrow()
  })

  it('rejects an internally consistent template built from a different source commit', async () => {
    const { projectDir, templateDir } = await createProjectBuild()
    await writeFile(
      join(templateDir, 'out', 'package.json'),
      JSON.stringify({ commit: 'b'.repeat(40) })
    )
    resealOrcadTemplateManifest(templateDir, ['out/package.json'])
    expect(() => assertOrcadTemplateBuilt(projectDir)).toThrow('source commit')
  })

  it('accepts channel-specific app versions when the source commit matches', async () => {
    quietly()
    const { projectDir } = await createProjectBuild()
    await writeFile(
      join(projectDir, 'out', 'package.json'),
      JSON.stringify({
        commit: 'a'.repeat(40),
        version: '1.4.214-dev.1'
      })
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

  it('rejects a template with an older Node reference even when its checksum was resealed', async () => {
    const { projectDir, templateDir } = await createProjectBuild()
    const marker = 'targets/linux-x64-glibc/.runtime-node'
    await writeFile(join(templateDir, ...marker.split('/')), `${'0'.repeat(64)}\n`)
    resealOrcadTemplateManifest(templateDir, [marker])
    expect(() => assertOrcadTemplateBuilt(projectDir)).toThrow('runtime reference disagrees')
  })
})

describe('packaged orcad template', () => {
  it('signs only darwin Mach-O payloads on macOS and reseals their new bytes', async () => {
    quietly()
    const { resourcesDir, templateDir, ptyPath } = await createResources()
    const signed = []
    const signMacBinary = async (path) => {
      signed.push(path)
      await appendFile(path, 'codesign-blob')
    }

    await finalizePackagedOrcadTemplate(resourcesDir, { platform: 'darwin', signMacBinary })

    expect(signed).toEqual([ptyPath])
    expect(findOrcadTemplateMachOFiles(templateDir)).toEqual([`targets/darwin-arm64/${PTY}`])
  })

  it('verifies without signing on Windows and Linux packages', async () => {
    quietly()
    const { resourcesDir } = await createResources()
    const signMacBinary = vi.fn()

    for (const platform of ['win32', 'linux']) {
      await finalizePackagedOrcadTemplate(resourcesDir, { platform, signMacBinary })
    }
    expect(signMacBinary).not.toHaveBeenCalled()
  })

  it('still rejects a changed file that no signer touched', async () => {
    quietly()
    const { resourcesDir, templateDir } = await createResources()
    await writeFile(join(templateDir, 'orcad.js'), 'tampered')

    await expect(
      finalizePackagedOrcadTemplate(resourcesDir, {
        platform: 'darwin',
        signMacBinary: async () => {}
      })
    ).rejects.toThrow('orcad.js checksum mismatch')
  })

  it('refuses to reseal a path the manifest never listed', async () => {
    const { templateDir } = await createResources()

    expect(() =>
      resealOrcadTemplateManifest(templateDir, ['targets/darwin-arm64/unlisted.node'])
    ).toThrow('is not a template manifest entry')
    expect(() => resealOrcadTemplateManifest(templateDir, ['targets/win32-x64'])).toThrow(
      'is not a template manifest entry'
    )
  })

  it('fails a required build without the template and lets a dev build skip it', async () => {
    quietly()
    const resourcesDir = await tempRoot()
    const env = { ORCA_REQUIRE_ORCAD_TEMPLATE: '1' }

    await expect(
      finalizePackagedOrcadTemplate(resourcesDir, { platform: 'linux', env })
    ).rejects.toThrow('missing the orcad deployment template')
    await expect(
      finalizePackagedOrcadTemplate(resourcesDir, { platform: 'linux', env: {} })
    ).resolves.toBeUndefined()
    expect(() => assertOrcadTemplateBuilt(resourcesDir, env)).toThrow(
      'ORCA_REQUIRE_ORCAD_TEMPLATE=1'
    )
    expect(() => assertOrcadTemplateBuilt(resourcesDir, {})).not.toThrow()
  })

  it('reseals the Windows files SignPath returned, by their app-relative list', async () => {
    quietly()
    const appDir = await tempRoot()
    const templateDir = await writeOrcadTemplateTestFixture(join(appDir, 'resources'))
    const conpty = 'node_modules/node-pty/build/Release/conpty.node'
    await appendFile(
      join(templateDir, ORCAD_TEMPLATE_TARGETS_DIR, 'win32-x64', ...conpty.split('/')),
      'authenticode'
    )
    const list = join(appDir, 'inner-signing-list.txt')
    await writeFile(
      list,
      [
        'Orca.exe',
        `resources\\orcad-template\\targets\\win32-x64\\${conpty.replaceAll('/', '\\')}`
      ].join('\r\n')
    )

    expect(() => resealSignedWindowsApp(appDir, list)).not.toThrow()
    const manifest = JSON.parse(
      await readFile(join(templateDir, ORCAD_TEMPLATE_MANIFEST_FILENAME), 'utf8')
    )
    const signedBytes = await readFile(
      join(templateDir, ORCAD_TEMPLATE_TARGETS_DIR, 'win32-x64', ...conpty.split('/'))
    )
    expect(manifest.targets['win32-x64'].files[conpty]).toBe(
      createHash('sha256').update(signedBytes).digest('hex')
    )
  })
})
