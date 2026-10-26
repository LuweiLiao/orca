import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { _resetSecretStoreForTests, setSecretStore } from '../../shared/secret-store'
import { AgentSudoService } from './agent-sudo-service'
import { AGENT_SUDO_ENDPOINT_ENV } from './agent-sudo-scripts'

describe.skipIf(process.platform === 'win32')('agent sudo service', () => {
  let userData: string
  let service: AgentSudoService

  beforeEach(async () => {
    userData = mkdtempSync(join(tmpdir(), 'orca-agent-sudo-service-'))
    setSecretStore({
      isEncryptionAvailable: () => true,
      encryptString: (plain) => Buffer.from(`sealed:${plain}`),
      decryptString: (sealed) => sealed.toString().slice('sealed:'.length),
      describeProtectionGap: () => null
    })
    service = new AgentSudoService()
    await service.start({ userDataPath: userData, confirm: async () => true })
  })

  afterEach(async () => {
    await service.stop()
    _resetSecretStoreForTests()
    rmSync(userData, { recursive: true, force: true })
  })

  it('points terminals at Orca only while a usable password is saved', () => {
    const shimDir = join(userData, 'agent-sudo', 'bin')
    const endpoint = join(userData, 'agent-sudo', 'endpoint')
    const env = (): Record<string, string> => {
      const next = { PATH: '/usr/bin' }
      service.applyChildEnv(next, 'linux')
      return next
    }

    expect(env()).toEqual({ PATH: '/usr/bin' })
    expect(existsSync(endpoint)).toBe(false)

    service.savePassword('secret')
    expect(env()).toEqual({
      PATH: `${shimDir}:/usr/bin`,
      SUDO_ASKPASS: join(userData, 'agent-sudo', 'askpass'),
      [AGENT_SUDO_ENDPOINT_ENV]: endpoint
    })
    expect(existsSync(endpoint)).toBe(true)

    // A pane spawned while active and respawned after clearing must lose the stale pointer.
    const inherited = env()
    service.clearPassword()
    service.applyChildEnv(inherited, 'linux')
    expect(inherited).toEqual({ PATH: '/usr/bin' })
    expect(existsSync(endpoint)).toBe(false)
  })
})
