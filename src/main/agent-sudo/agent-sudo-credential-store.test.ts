import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { _resetSecretStoreForTests, setSecretStore } from '../../shared/secret-store'
import { createAgentSudoCredentialStore } from './agent-sudo-credential-store'

const cipher: { available: boolean; gap: string | null } = { available: true, gap: null }

describe('agent sudo credential store', () => {
  let dir: string

  beforeEach(() => {
    cipher.available = true
    cipher.gap = null
    dir = mkdtempSync(join(tmpdir(), 'orca-agent-sudo-store-'))
    setSecretStore({
      isEncryptionAvailable: () => cipher.available,
      encryptString: (plain) => Buffer.from(`sealed:${plain}`),
      decryptString: (sealed) => sealed.toString().slice('sealed:'.length),
      describeProtectionGap: () => cipher.gap
    })
  })

  afterEach(() => {
    _resetSecretStoreForTests()
    rmSync(dir, { recursive: true, force: true })
  })

  it('stores the password sealed, never as plaintext', () => {
    createAgentSudoCredentialStore(dir).savePassword(' pass word ')
    expect(readFileSync(join(dir, 'credential.json'), 'utf8')).not.toContain('pass word')
    expect(createAgentSudoCredentialStore(dir).readPassword()).toBe(' pass word ')
  })

  it('refuses to save unless the OS keyring really protects it', () => {
    const store = createAgentSudoCredentialStore(dir)
    cipher.available = false
    expect(() => store.savePassword('secret')).toThrow(/Encrypted storage is unavailable/)
    cipher.available = true
    cipher.gap = 'basic_text built-in key'
    expect(() => store.savePassword('secret')).toThrow(/Encrypted storage is unavailable/)
    expect(store.hasPassword()).toBe(false)
  })

  it('keeps the chosen mode when the password is removed', () => {
    const store = createAgentSudoCredentialStore(dir)
    store.saveMode('auto')
    store.savePassword('secret')
    store.clearPassword()
    const reopened = createAgentSudoCredentialStore(dir)
    expect(reopened.hasPassword()).toBe(false)
    expect(reopened.readMode()).toBe('auto')
  })
})
