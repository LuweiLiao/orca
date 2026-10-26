import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { getSecretStore } from '../../shared/secret-store'
import { writeSecureFile } from '../../shared/secure-file'
import {
  DEFAULT_AGENT_SUDO_MODE,
  isAgentSudoMode,
  isValidAgentSudoPassword,
  type AgentSudoMode
} from '../../shared/agent-sudo-types'

type StoredAgentSudoCredential = {
  version: 1
  mode: AgentSudoMode
  sealedPasswordBase64?: string
}

export type AgentSudoCredentialStore = {
  hasPassword: () => boolean
  readPassword: () => string | null
  savePassword: (password: string) => void
  clearPassword: () => void
  readMode: () => AgentSudoMode
  saveMode: (mode: AgentSudoMode) => void
  protectionGap: () => string | null
}

export function createAgentSudoCredentialStore(directory: string): AgentSudoCredentialStore {
  const filePath = join(directory, 'credential.json')
  let cachedPassword: string | null = null

  function readStored(): StoredAgentSudoCredential {
    if (!existsSync(filePath)) {
      return { version: 1, mode: DEFAULT_AGENT_SUDO_MODE }
    }
    try {
      const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'))
      if (!parsed || typeof parsed !== 'object') {
        return { version: 1, mode: DEFAULT_AGENT_SUDO_MODE }
      }
      const mode =
        'mode' in parsed && isAgentSudoMode(parsed.mode) ? parsed.mode : DEFAULT_AGENT_SUDO_MODE
      const sealed =
        'sealedPasswordBase64' in parsed && typeof parsed.sealedPasswordBase64 === 'string'
          ? parsed.sealedPasswordBase64
          : undefined
      return { version: 1, mode, ...(sealed ? { sealedPasswordBase64: sealed } : {}) }
    } catch {
      return { version: 1, mode: DEFAULT_AGENT_SUDO_MODE }
    }
  }

  function writeStored(stored: StoredAgentSudoCredential): void {
    writeSecureFile(filePath, `${JSON.stringify(stored)}\n`, { durable: true })
  }

  return {
    hasPassword: () => readStored().sealedPasswordBase64 !== undefined,
    readPassword: () => {
      if (cachedPassword !== null) {
        return cachedPassword
      }
      const sealed = readStored().sealedPasswordBase64
      if (!sealed) {
        return null
      }
      const store = getSecretStore()
      if (!store.isEncryptionAvailable()) {
        return null
      }
      try {
        cachedPassword = store.decryptString(Buffer.from(sealed, 'base64'))
        return cachedPassword
      } catch (error) {
        console.warn('[agent-sudo] saved sudo password could not be decrypted', error)
        return null
      }
    },
    savePassword: (password) => {
      if (!isValidAgentSudoPassword(password)) {
        throw new Error('Invalid sudo password')
      }
      const store = getSecretStore()
      // Why: a root credential must not fall back to plaintext, nor to basic_text's built-in key.
      if (!store.isEncryptionAvailable() || store.describeProtectionGap() !== null) {
        throw new Error('Encrypted storage is unavailable on this system')
      }
      const sealed = store.encryptString(password).toString('base64')
      writeStored({ ...readStored(), sealedPasswordBase64: sealed })
      cachedPassword = password
    },
    clearPassword: () => {
      cachedPassword = null
      const { mode } = readStored()
      if (mode === DEFAULT_AGENT_SUDO_MODE) {
        rmSync(filePath, { force: true })
        return
      }
      writeStored({ version: 1, mode })
    },
    readMode: () => readStored().mode,
    saveMode: (mode) => {
      const { sealedPasswordBase64 } = readStored()
      writeStored({ version: 1, mode, ...(sealedPasswordBase64 ? { sealedPasswordBase64 } : {}) })
    },
    protectionGap: () => getSecretStore().describeProtectionGap()
  }
}
