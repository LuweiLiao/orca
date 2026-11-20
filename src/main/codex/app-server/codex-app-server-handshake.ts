import { codexClientInfo } from './codex-client-info'
import type { CodexAppServerConnection } from './codex-app-server-connection-types'

/** The caller owns the bound; null leaves cancellation to its startup signal. */
export async function initializeCodexAppServerConnection(
  connection: CodexAppServerConnection,
  command: string,
  timeoutMs: number | null
): Promise<void> {
  await connection.request(
    'initialize',
    {
      clientInfo: codexClientInfo(command),
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
        mcpServerOpenaiFormElicitation: false,
        extensions: {}
      }
    },
    { timeoutMs }
  )
  connection.notify('initialized')
}
