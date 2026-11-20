import { describe, expect, it, vi } from 'vitest'
import { nextLlwBuildVersion, runLocalLinuxBuild } from './build-linux-local.mjs'

describe('LLW local Linux builds', () => {
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

  it('passes the next local version and build number to electron-builder', () => {
    const execFile = vi.fn()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    runLocalLinuxBuild({
      arch: 'arm64',
      execFile,
      platform: 'linux',
      cwd: '/workspace',
      baseVersion: '1.4.214',
      artifactNames: ['orca-ide_1.4.215-llw1_amd64.deb']
    })
    expect(execFile.mock.calls[0]?.[2]?.env).toMatchObject({
      ORCA_LINUX_ARM64_RELEASE: '1',
      ORCA_LOCAL_BUILD_VERSION: '1.4.215-llw2',
      ORCA_LLW_BUILD_NUMBER: '2'
    })
  })
})
