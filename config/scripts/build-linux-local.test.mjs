import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  buildLinuxElectronBuilderArgs,
  nextLlwBuildVersion,
  resolveLinuxBuildArch,
  runLocalLinuxBuild
} from './build-linux-local.mjs'

const require = createRequire(import.meta.url)

describe('local Linux build target', () => {
  it('increments the llw package version while staying newer than the release base', () => {
    expect(nextLlwBuildVersion('1.4.214', [])).toBe('1.4.215-llw1')
    expect(
      nextLlwBuildVersion('1.4.214', [
        'orca-ide_1.4.215-llw1_amd64.deb',
        'orca-ide_1.4.215-llw2_arm64.deb',
        'orca-ide_1.4.214-llw9_amd64.deb'
      ])
    ).toBe('1.4.215-llw3')
    expect(() => nextLlwBuildVersion('1.4.214-rc.1', [])).toThrow('Unsupported LLW base version')
  })

  it('passes the local version into package metadata and the AppImage filename', () => {
    const configPath = require.resolve('../electron-builder.config.cjs')
    const originalVersion = process.env.ORCA_LOCAL_BUILD_VERSION
    const originalNumber = process.env.ORCA_LLW_BUILD_NUMBER
    try {
      process.env.ORCA_LOCAL_BUILD_VERSION = '1.4.215-llw1'
      process.env.ORCA_LLW_BUILD_NUMBER = '1'
      delete require.cache[configPath]
      const config = require('../electron-builder.config.cjs')
      expect(config.extraMetadata).toEqual({ version: '1.4.215-llw1' })
      expect(config.appImage.artifactName).toBe('orca-linux-llw1.${ext}')
    } finally {
      if (originalVersion === undefined) {
        delete process.env.ORCA_LOCAL_BUILD_VERSION
      } else {
        process.env.ORCA_LOCAL_BUILD_VERSION = originalVersion
      }
      if (originalNumber === undefined) {
        delete process.env.ORCA_LLW_BUILD_NUMBER
      } else {
        process.env.ORCA_LLW_BUILD_NUMBER = originalNumber
      }
      delete require.cache[configPath]
    }
  })

  it('is the package script used by the local Linux build', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '../../package.json'), 'utf8')
    )
    expect(packageJson.scripts['build:linux']).toContain(
      'node config/scripts/build-linux-local.mjs'
    )
  })

  it('follows a native Linux host architecture', () => {
    expect(resolveLinuxBuildArch({ platform: 'linux', hostArch: 'arm64' })).toBe('arm64')
    expect(resolveLinuxBuildArch({ platform: 'linux', hostArch: 'x64' })).toBe('x64')
  })

  it('defaults cross-platform Linux builds to x64 and allows an explicit override', () => {
    expect(resolveLinuxBuildArch({ platform: 'darwin', hostArch: 'arm64' })).toBe('x64')
    expect(
      resolveLinuxBuildArch({ platform: 'darwin', hostArch: 'arm64', requestedArch: 'arm64' })
    ).toBe('arm64')
  })

  it('rejects unsupported architectures', () => {
    expect(() => resolveLinuxBuildArch({ platform: 'linux', hostArch: 'ia32' })).toThrow(
      'Unsupported Linux build architecture'
    )
    expect(() => buildLinuxElectronBuilderArgs('ia32')).toThrow(
      'Unsupported Linux build architecture'
    )
  })

  it('passes an explicit target and matching artifact-name environment', () => {
    const execFile = vi.fn()
    runLocalLinuxBuild({
      arch: 'arm64',
      environment: { PATH: '/bin', ORCA_LINUX_ARM64_RELEASE: undefined },
      execFile,
      platform: 'linux',
      cwd: '/workspace',
      baseVersion: '1.4.214',
      artifactNames: []
    })
    expect(execFile).toHaveBeenCalledWith(
      'pnpm',
      buildLinuxElectronBuilderArgs('arm64'),
      expect.objectContaining({
        cwd: '/workspace',
        env: expect.objectContaining({
          ORCA_LINUX_ARM64_RELEASE: '1',
          ORCA_LOCAL_BUILD_VERSION: '1.4.215-llw1',
          ORCA_LLW_BUILD_NUMBER: '1'
        }),
        stdio: 'inherit'
      })
    )

    expect(buildLinuxElectronBuilderArgs('x64')).toEqual(
      expect.arrayContaining(['--linux', 'AppImage', 'deb', 'rpm', '--x64'])
    )

    runLocalLinuxBuild({
      arch: 'x64',
      environment: { PATH: '/bin', ORCA_LINUX_ARM64_RELEASE: '1' },
      execFile,
      platform: 'linux',
      cwd: '/workspace',
      baseVersion: '1.4.214',
      artifactNames: ['orca-ide_1.4.215-llw1_amd64.deb']
    })
    expect(execFile).toHaveBeenLastCalledWith(
      'pnpm',
      buildLinuxElectronBuilderArgs('x64'),
      expect.objectContaining({
        env: expect.not.objectContaining({ ORCA_LINUX_ARM64_RELEASE: expect.anything() })
      })
    )
    expect(execFile.mock.calls.at(-1)?.[2]?.env.ORCA_LOCAL_BUILD_VERSION).toBe('1.4.215-llw2')
  })

  it('uses the Windows pnpm command name when cross-host packaging', () => {
    const execFile = vi.fn()
    runLocalLinuxBuild({
      arch: 'x64',
      execFile,
      platform: 'win32',
      cwd: 'C:\\workspace',
      baseVersion: '1.4.214',
      artifactNames: []
    })
    expect(execFile.mock.calls[0]?.[0]).toBe('pnpm.cmd')
  })
})
