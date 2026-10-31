import type { LanguageServerId } from '../../../../shared/language-server-types'
import {
  createLanguageServerConnection,
  type LanguageServerConnection
} from './language-server-connection'
import type { LspServerCapabilities } from './language-server-protocol'

/** A started and initialized language server for one workspace root. */
export type LanguageServerClient = {
  serverId: LanguageServerId
  rootUri: string
  connection: LanguageServerConnection
  capabilities: LspServerCapabilities
  /** 1 full text, 2 incremental edits. */
  syncKind: 1 | 2
  sendsSave: boolean
  stop: () => void
}

export type LanguageServerClientStart =
  | { ok: true; client: LanguageServerClient }
  | { ok: false; reason: 'missing' | 'unauthorized' | 'failed'; message: string }

const CLIENT_CAPABILITIES = {
  general: { positionEncodings: ['utf-16'] },
  workspace: { configuration: true, workspaceFolders: true },
  window: { workDoneProgress: false, showMessage: { messageActionItem: {} } },
  textDocument: {
    synchronization: { didSave: true, dynamicRegistration: false },
    completion: {
      completionItem: {
        snippetSupport: true,
        documentationFormat: ['markdown', 'plaintext'],
        deprecatedSupport: true,
        tagSupport: { valueSet: [1] },
        insertReplaceSupport: true,
        labelDetailsSupport: true,
        resolveSupport: { properties: ['documentation', 'detail', 'additionalTextEdits'] }
      },
      contextSupport: true
    },
    hover: { contentFormat: ['markdown', 'plaintext'] },
    signatureHelp: {
      signatureInformation: {
        documentationFormat: ['markdown', 'plaintext'],
        parameterInformation: { labelOffsetSupport: true },
        activeParameterSupport: true
      }
    },
    definition: { linkSupport: true },
    declaration: { linkSupport: true },
    typeDefinition: { linkSupport: true },
    implementation: { linkSupport: true },
    references: {},
    documentHighlight: {},
    documentSymbol: { hierarchicalDocumentSymbolSupport: true, tagSupport: { valueSet: [1] } },
    publishDiagnostics: { relatedInformation: true, tagSupport: { valueSet: [1, 2] } }
  }
}

function syncKindOf(capabilities: LspServerCapabilities): 1 | 2 {
  const sync = capabilities.textDocumentSync
  const change = typeof sync === 'number' ? sync : sync?.change
  return change === 2 ? 2 : 1
}

function sendsSaveOf(capabilities: LspServerCapabilities): boolean {
  const sync = capabilities.textDocumentSync
  return typeof sync === 'object' && sync !== null && Boolean(sync.save)
}

/**
 * Starts `serverId` in `rootPath` through the desktop bridge and runs the LSP handshake. Server
 * messages arrive through `subscribe`, which the registry fans out by session id.
 */
export async function startLanguageServerClient(args: {
  serverId: LanguageServerId
  rootPath: string
  rootUri: string
  subscribe: (sessionId: string, receive: (message: unknown) => void) => () => void
  onNotification: (connection: LanguageServerConnection) => void
}): Promise<LanguageServerClientStart> {
  const api = window.api?.languageServer
  const started = api ? await api.start({ serverId: args.serverId, rootPath: args.rootPath }) : null
  if (!started) {
    return { ok: false, reason: 'failed', message: 'Language servers need the desktop app' }
  }
  if (!started.ok) {
    return started
  }
  const { sessionId } = started
  const connection = createLanguageServerConnection((message) => api?.send(sessionId, message))
  const unsubscribe = args.subscribe(sessionId, connection.receive)
  const name = args.rootPath.split(/[/\\]/).findLast(Boolean) ?? args.rootPath
  connection.onRequest('workspace/configuration', (params) => {
    const items: unknown = typeof params === 'object' && params ? Reflect.get(params, 'items') : []
    return Array.isArray(items) ? items.map(() => null) : []
  })
  connection.onRequest('client/registerCapability', () => null)
  connection.onRequest('client/unregisterCapability', () => null)
  connection.onRequest('window/workDoneProgress/create', () => null)
  connection.onRequest('window/showMessageRequest', () => null)
  connection.onRequest('workspace/workspaceFolders', () => [{ uri: args.rootUri, name }])
  args.onNotification(connection)
  const stop = (): void => {
    unsubscribe()
    connection.close('Language server stopped')
    api?.stop(sessionId)
  }
  try {
    const result = await connection.request<{ capabilities?: LspServerCapabilities }>(
      'initialize',
      {
        processId: null,
        clientInfo: { name: 'Orca' },
        rootUri: args.rootUri,
        rootPath: args.rootPath,
        workspaceFolders: [{ uri: args.rootUri, name }],
        capabilities: CLIENT_CAPABILITIES,
        initializationOptions: started.initializationOptions
      }
    )
    connection.notify('initialized', {})
    const capabilities = result?.capabilities ?? {}
    return {
      ok: true,
      client: {
        serverId: args.serverId,
        rootUri: args.rootUri,
        connection,
        capabilities,
        syncKind: syncKindOf(capabilities),
        sendsSave: sendsSaveOf(capabilities),
        stop: () => {
          // Why shutdown first: servers flush their index on shutdown; stdin EOF follows.
          void connection
            .request('shutdown', null)
            .catch(() => null)
            .finally(() => {
              connection.notify('exit', null)
              stop()
            })
        }
      }
    }
  } catch (error) {
    stop()
    return { ok: false, reason: 'failed', message: String(error) }
  }
}
