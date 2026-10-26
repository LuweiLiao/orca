import { chmodSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { writeSecureFile } from '../../shared/secure-file'
import type { AgentSudoMode, AgentSudoStatus } from '../../shared/agent-sudo-types'
import { readInheritedPath } from '../ipc/pty/host-env/path'
import {
  startAgentSudoAskpassServer,
  type AgentSudoAskpassServer
} from './agent-sudo-askpass-server'
import {
  createAgentSudoCredentialStore,
  type AgentSudoCredentialStore
} from './agent-sudo-credential-store'
import {
  createAgentSudoDecision,
  type AgentSudoConfirm,
  type AgentSudoDecision
} from './agent-sudo-decision'
import {
  AGENT_SUDO_ENDPOINT_ENV,
  renderAgentSudoAskpassScript,
  renderAgentSudoShimScript,
  resolveRealSudoPath
} from './agent-sudo-scripts'

const AGENT_SUDO_DIR = 'agent-sudo'

type AgentSudoPaths = {
  root: string
  askpass: string
  shimBinDir: string
  endpoint: string
}

function writeExecutable(path: string, contents: string): void {
  const staged = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  writeFileSync(staged, contents, { mode: 0o700 })
  chmodSync(staged, 0o700)
  // Rename keeps a concurrently exec'd script whole.
  renameSync(staged, path)
}

export class AgentSudoService {
  private paths: AgentSudoPaths | null = null
  private store: AgentSudoCredentialStore | null = null
  private decision: AgentSudoDecision | null = null
  private server: AgentSudoAskpassServer | null = null

  async start(options: {
    userDataPath: string
    endpointNamespace?: string
    confirm: AgentSudoConfirm
    platform?: NodeJS.Platform
  }): Promise<void> {
    if ((options.platform ?? process.platform) === 'win32' || this.server) {
      return
    }
    const root = join(options.userDataPath, AGENT_SUDO_DIR)
    const paths: AgentSudoPaths = {
      root,
      askpass: join(root, 'askpass'),
      shimBinDir: join(root, 'bin'),
      endpoint: join(
        root,
        options.endpointNamespace ? `endpoint-${options.endpointNamespace}` : 'endpoint'
      )
    }
    mkdirSync(paths.shimBinDir, { recursive: true, mode: 0o700 })
    writeExecutable(paths.askpass, renderAgentSudoAskpassScript())
    const realSudo = resolveRealSudoPath()
    if (realSudo) {
      writeExecutable(join(paths.shimBinDir, 'sudo'), renderAgentSudoShimScript(realSudo))
    } else {
      rmSync(join(paths.shimBinDir, 'sudo'), { force: true })
    }
    const store = createAgentSudoCredentialStore(root)
    const decision = createAgentSudoDecision({
      hasPassword: () => store.hasPassword(),
      readPassword: () => store.readPassword(),
      readMode: () => store.readMode(),
      confirm: options.confirm,
      onRejected: () => {
        console.warn('[agent-sudo] sudo rejected the saved password; Orca stops supplying it')
        this.syncEndpoint()
      }
    })
    this.server = await startAgentSudoAskpassServer({
      onRequest: (request, signal) => decision.handle(request, signal)
    })
    this.paths = paths
    this.store = store
    this.decision = decision
    this.syncEndpoint()
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    if (this.paths) {
      rmSync(this.paths.endpoint, { force: true })
    }
    await server?.close()
  }

  /** Point sudo at Orca for a local POSIX pane, or strip a stale pointer when inactive. */
  applyChildEnv(env: Record<string, string>, platform: NodeJS.Platform = process.platform): void {
    if (platform === 'win32' || !this.paths) {
      return
    }
    const { askpass, shimBinDir, endpoint } = this.paths
    const others = readInheritedPath(env, platform)
      .split(delimiter)
      .filter((entry) => entry.length > 0 && entry !== shimBinDir)
    if (!this.isActive()) {
      if (env.SUDO_ASKPASS === askpass) {
        delete env.SUDO_ASKPASS
      }
      delete env[AGENT_SUDO_ENDPOINT_ENV]
      if (env.PATH !== undefined) {
        env.PATH = others.join(delimiter)
      }
      return
    }
    env.SUDO_ASKPASS = askpass
    env[AGENT_SUDO_ENDPOINT_ENV] = endpoint
    env.PATH = [shimBinDir, ...others].join(delimiter)
  }

  /** Values a per-command env policy (Codex) must keep; never PATH. */
  commandEnv(): Record<string, string> {
    if (!this.paths || !this.isActive()) {
      return {}
    }
    return { SUDO_ASKPASS: this.paths.askpass, [AGENT_SUDO_ENDPOINT_ENV]: this.paths.endpoint }
  }

  getStatus(platform: NodeJS.Platform = process.platform): AgentSudoStatus {
    const store = this.store
    return {
      supported: platform !== 'win32' && store !== null,
      configured: store?.hasPassword() ?? false,
      mode: store?.readMode() ?? 'confirm',
      rejected: this.decision?.isRejected() ?? false,
      protectionGap: store?.protectionGap() ?? null
    }
  }

  savePassword(password: string): AgentSudoStatus {
    this.requireStore().savePassword(password)
    this.decision?.reset()
    this.syncEndpoint()
    return this.getStatus()
  }

  clearPassword(): AgentSudoStatus {
    this.requireStore().clearPassword()
    this.decision?.reset()
    this.syncEndpoint()
    return this.getStatus()
  }

  setMode(mode: AgentSudoMode): AgentSudoStatus {
    this.requireStore().saveMode(mode)
    return this.getStatus()
  }

  private isActive(): boolean {
    return (
      this.server !== null && (this.store?.hasPassword() ?? false) && !this.decision?.isRejected()
    )
  }

  private requireStore(): AgentSudoCredentialStore {
    if (!this.store) {
      throw new Error('sudo password storage is unavailable on this host')
    }
    return this.store
  }

  // Without a published endpoint the helper exits at once and sudo reports no password.
  private syncEndpoint(): void {
    if (!this.paths) {
      return
    }
    if (this.server && this.isActive()) {
      writeSecureFile(this.paths.endpoint, this.server.endpointLine)
    } else {
      rmSync(this.paths.endpoint, { force: true })
    }
  }
}

export const agentSudoService = new AgentSudoService()
