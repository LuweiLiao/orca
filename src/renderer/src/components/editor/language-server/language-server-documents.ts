import { editor as monacoEditor, Uri, type editor, type IDisposable } from 'monaco-editor'
import { ORCA_EDITOR_FILE_SAVED_EVENT } from '@/components/editor/editor-autosave'
import type { LanguageServerId } from '../../../../../shared/language-server-types'
import type { LanguageServerClient } from '@/lib/language-server/language-server-client'
import type { LspDiagnostic } from '@/lib/language-server/language-server-protocol'
import { toLspRange, toMonacoMarker } from '@/lib/language-server/language-server-monaco-convert'
import {
  acquireLanguageServer,
  releaseLanguageServer,
  setLanguageServerLifecycle,
  type LanguageServerEntry
} from '@/lib/language-server/language-server-registry'

/** A Monaco model the server knows about; shared by every editor showing that model. */
export type LanguageServerDocument = {
  uri: string
  model: editor.ITextModel
  entry: LanguageServerEntry
  languageId: string
  refs: number
  opened: boolean
  fileIds: Set<string>
  disposables: IDisposable[]
}

const documents = new Map<string, LanguageServerDocument>()

export function markerOwner(serverId: LanguageServerId): string {
  return `orca-lsp:${serverId}`
}

export function languageServerDocumentFor(
  model: editor.ITextModel
): LanguageServerDocument | undefined {
  return documents.get(model.uri.toString())
}

/** The client once the server has this model open, so a request sees the current text. */
export async function readyDocumentClient(
  model: editor.ITextModel
): Promise<{ document: LanguageServerDocument; client: LanguageServerClient } | null> {
  const document = languageServerDocumentFor(model)
  const client = document ? await document.entry.ready : null
  return document && client && document.opened && !model.isDisposed() ? { document, client } : null
}

function sendOpen(document: LanguageServerDocument, client: LanguageServerClient): void {
  if (document.opened || document.model.isDisposed()) {
    return
  }
  document.opened = true
  client.connection.notify('textDocument/didOpen', {
    textDocument: {
      uri: document.uri,
      languageId: document.languageId,
      version: document.model.getVersionId(),
      text: document.model.getValue()
    }
  })
}

function sendChange(
  document: LanguageServerDocument,
  event: editor.IModelContentChangedEvent
): void {
  const client = document.entry.client
  if (!client || !document.opened) {
    return
  }
  client.connection.notify('textDocument/didChange', {
    textDocument: { uri: document.uri, version: event.versionId },
    contentChanges:
      client.syncKind === 2
        ? event.changes.map((change) => ({ range: toLspRange(change.range), text: change.text }))
        : [{ text: document.model.getValue() }]
  })
}

function close(document: LanguageServerDocument): void {
  documents.delete(document.uri)
  for (const disposable of document.disposables) {
    disposable.dispose()
  }
  if (document.opened) {
    document.entry.client?.connection.notify('textDocument/didClose', {
      textDocument: { uri: document.uri }
    })
  }
  if (!document.model.isDisposed()) {
    monacoEditor.setModelMarkers(document.model, markerOwner(document.entry.serverId), [])
  }
  releaseLanguageServer(document.entry)
}

setLanguageServerLifecycle({
  ready: (entry, client) => {
    for (const document of documents.values()) {
      if (document.entry === entry) {
        sendOpen(document, client)
      }
    }
  },
  lost: (entry) => {
    for (const document of documents.values()) {
      if (document.entry === entry) {
        document.opened = false
        if (!document.model.isDisposed()) {
          monacoEditor.setModelMarkers(document.model, markerOwner(entry.serverId), [])
        }
      }
    }
  },
  notifications: (entry, connection) => {
    connection.onNotification('textDocument/publishDiagnostics', (params) => {
      const uri: unknown = typeof params === 'object' && params ? Reflect.get(params, 'uri') : null
      const list: unknown =
        typeof params === 'object' && params ? Reflect.get(params, 'diagnostics') : null
      if (typeof uri !== 'string' || !Array.isArray(list)) {
        return
      }
      // Why re-key: servers may encode a path differently from Monaco's own URI string.
      const model = monacoEditor.getModel(Uri.parse(uri))
      if (model && languageServerDocumentFor(model)?.entry === entry) {
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: publishDiagnostics carries LSP Diagnostic objects; the converter reads only their typed fields.
        const diagnostics = list as LspDiagnostic[]
        monacoEditor.setModelMarkers(
          model,
          markerOwner(entry.serverId),
          diagnostics.map(toMonacoMarker)
        )
      }
    })
  }
})

/**
 * Tells `serverId` (started for `rootPath`) that `model` is open; the returned function releases
 * this editor's hold. Several editors of one model share one open document.
 */
export function attachLanguageServerDocument(args: {
  model: editor.ITextModel
  fileId: string
  serverId: LanguageServerId
  languageId: string
  rootPath: string
}): () => void {
  const uri = args.model.uri.toString()
  let document = documents.get(uri)
  if (!document) {
    const entry = acquireLanguageServer(
      args.serverId,
      args.rootPath,
      Uri.file(args.rootPath).toString()
    )
    if (!entry) {
      return () => undefined
    }
    const created: LanguageServerDocument = {
      uri,
      model: args.model,
      entry,
      languageId: args.languageId,
      refs: 0,
      opened: false,
      fileIds: new Set(),
      disposables: []
    }
    created.disposables.push(
      args.model.onDidChangeContent((event) => sendChange(created, event)),
      args.model.onWillDispose(() => close(created))
    )
    documents.set(uri, created)
    document = created
    if (entry.client) {
      sendOpen(created, entry.client)
    }
  }
  const held = document
  held.refs += 1
  held.fileIds.add(args.fileId)
  let released = false
  return () => {
    if (released) {
      return
    }
    released = true
    held.refs -= 1
    if (held.refs <= 0 && documents.get(uri) === held) {
      close(held)
    }
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener(ORCA_EDITOR_FILE_SAVED_EVENT, (event) => {
    const fileId: unknown =
      event instanceof CustomEvent && event.detail ? Reflect.get(event.detail, 'fileId') : null
    if (typeof fileId !== 'string') {
      return
    }
    for (const document of documents.values()) {
      if (document.fileIds.has(fileId) && document.entry.client?.sendsSave) {
        document.entry.client.connection.notify('textDocument/didSave', {
          textDocument: { uri: document.uri }
        })
      }
    }
  })
}
