import { useEffect } from 'react'
import type { editor } from 'monaco-editor'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { attachLanguageServerDocument } from './language-server-documents'
import { languageServerProjectRoot } from './language-server-project-root'
import { languageServerRouteFor, type LanguageServerRoute } from './language-server-routing'

function routeOf(
  state: AppState,
  fileId: string,
  language: string,
  enabled: boolean
): LanguageServerRoute | null {
  const file = enabled ? state.openFiles?.find((entry) => entry.id === fileId) : undefined
  return file ? languageServerRouteFor(state, file, language) : null
}

/** Keeps `fileId`'s model open in its language server while this editor shows it. */
export function useLanguageServerDocument(
  mountedEditor: editor.IStandaloneCodeEditor | null,
  fileId: string,
  modelUri: string,
  language: string,
  enabled: boolean
): void {
  // Why three selectors: a fresh route object on every store change would re-run the effect.
  const serverId = useAppStore((state) => routeOf(state, fileId, language, enabled)?.serverId)
  const lspLanguageId = useAppStore(
    (state) => routeOf(state, fileId, language, enabled)?.lspLanguageId
  )
  const rootPath = useAppStore((state) => routeOf(state, fileId, language, enabled)?.rootPath)
  useEffect(() => {
    const model = mountedEditor?.getModel()
    if (!serverId || !lspLanguageId || !rootPath || !model) {
      return
    }
    // Why `file:` only: owned (remote) model URIs are not paths this computer's server can read.
    if (model.uri.toString() !== modelUri || model.uri.scheme !== 'file') {
      return
    }
    let cancelled = false
    let release: (() => void) | null = null
    void languageServerProjectRoot(serverId, rootPath, model.uri.fsPath).then((projectRoot) => {
      if (!cancelled && !model.isDisposed()) {
        release = attachLanguageServerDocument({
          model,
          fileId,
          serverId,
          languageId: lspLanguageId,
          rootPath: projectRoot
        })
      }
    })
    return () => {
      cancelled = true
      release?.()
    }
  }, [mountedEditor, fileId, modelUri, serverId, lspLanguageId, rootPath])
}
