import {
  editor as monacoEditor,
  languages,
  Range,
  type CancellationToken,
  type editor,
  type IDisposable,
  type Position
} from 'monaco-editor'
import type {
  LspCompletionItem,
  LspCompletionList,
  LspDocumentHighlight,
  LspDocumentSymbol,
  LspHover,
  LspLocation,
  LspLocationLink,
  LspServerCapabilities,
  LspSignatureHelp,
  LspSymbolInformation
} from '@/lib/language-server/language-server-protocol'
import {
  toLspPosition,
  toMonacoCompletion,
  toMonacoHighlights,
  toMonacoHover,
  toMonacoLocations,
  toMonacoSignatureHelp,
  toMonacoSymbols
} from '@/lib/language-server/language-server-monaco-convert'
import { readyDocumentClient } from './language-server-documents'
import { openLanguageServerTarget, preloadLocationModels } from './language-server-file-targets'
import { LANGUAGE_SERVER_MONACO_LANGUAGES } from './language-server-routing'

// Union of what the servers ask for; a server ignores the rest.
const COMPLETION_TRIGGERS = ['.', ':', '>', '<', '"', '/', '*', '(', '[', '@', '#', "'", '`']
const SIGNATURE_TRIGGERS = ['(', ',', '<']

function signalOf(token: CancellationToken): AbortSignal {
  const controller = new AbortController()
  if (token.isCancellationRequested) {
    controller.abort()
  } else {
    token.onCancellationRequested(() => controller.abort())
  }
  return controller.signal
}

function positionParams(model: editor.ITextModel, position: Position) {
  return { textDocument: { uri: model.uri.toString() }, position: toLspPosition(position) }
}

async function call<T>(
  model: editor.ITextModel,
  capability: keyof LspServerCapabilities,
  method: string,
  params: unknown,
  token: CancellationToken
): Promise<T | null> {
  const ready = await readyDocumentClient(model)
  if (!ready || !ready.client.capabilities[capability] || token.isCancellationRequested) {
    return null
  }
  try {
    return await ready.client.connection.request<T>(method, params, signalOf(token))
  } catch {
    // Why quiet: a cancelled or failed lookup just shows nothing, as in VS Code.
    return null
  }
}

async function locations(
  model: editor.ITextModel,
  capability: keyof LspServerCapabilities,
  method: string,
  params: unknown,
  token: CancellationToken
): Promise<languages.LocationLink[]> {
  const result = await call<LspLocation | LspLocation[] | LspLocationLink[]>(
    model,
    capability,
    method,
    params,
    token
  )
  const converted = toMonacoLocations(result)
  await preloadLocationModels(converted.map((location) => location.uri))
  return converted
}

const lspItems = new WeakMap<
  languages.CompletionItem,
  { item: LspCompletionItem; model: editor.ITextModel }
>()

/** Registers Monaco providers that answer from the language server owning each model. */
export function registerLanguageServerProviders(): IDisposable {
  const selector = [...LANGUAGE_SERVER_MONACO_LANGUAGES]
  const disposables: IDisposable[] = [
    monacoEditor.registerEditorOpener({ openCodeEditor: openLanguageServerTarget }),
    languages.registerCompletionItemProvider(selector, {
      triggerCharacters: COMPLETION_TRIGGERS,
      async provideCompletionItems(model, position, context, token) {
        const result = await call<LspCompletionList | LspCompletionItem[]>(
          model,
          'completionProvider',
          'textDocument/completion',
          {
            ...positionParams(model, position),
            context: {
              triggerKind: context.triggerKind + 1,
              triggerCharacter: context.triggerCharacter
            }
          },
          token
        )
        if (!result) {
          return { suggestions: [] }
        }
        const word = model.getWordUntilPosition(position)
        const wordRange = new Range(
          position.lineNumber,
          word.startColumn,
          position.lineNumber,
          word.endColumn
        )
        const items = Array.isArray(result) ? result : result.items
        return {
          incomplete: !Array.isArray(result) && result.isIncomplete,
          suggestions: items.map((item) => {
            const suggestion = toMonacoCompletion(item, wordRange)
            lspItems.set(suggestion, { item, model })
            return suggestion
          })
        }
      },
      async resolveCompletionItem(suggestion, token) {
        const original = lspItems.get(suggestion)
        if (!original) {
          return suggestion
        }
        const ready = await readyDocumentClient(original.model)
        if (!ready?.client.capabilities.completionProvider?.resolveProvider) {
          return suggestion
        }
        try {
          const resolved = await ready.client.connection.request<LspCompletionItem>(
            'completionItem/resolve',
            original.item,
            signalOf(token)
          )
          const range = suggestion.range
          return {
            ...toMonacoCompletion(resolved, Range.lift('insert' in range ? range.insert : range)),
            range
          }
        } catch {
          return suggestion
        }
      }
    }),
    languages.registerHoverProvider(selector, {
      async provideHover(model, position, token) {
        return toMonacoHover(
          await call<LspHover>(
            model,
            'hoverProvider',
            'textDocument/hover',
            positionParams(model, position),
            token
          )
        )
      }
    }),
    languages.registerSignatureHelpProvider(selector, {
      signatureHelpTriggerCharacters: SIGNATURE_TRIGGERS,
      signatureHelpRetriggerCharacters: [')'],
      async provideSignatureHelp(model, position, token) {
        const value = toMonacoSignatureHelp(
          await call<LspSignatureHelp>(
            model,
            'signatureHelpProvider',
            'textDocument/signatureHelp',
            positionParams(model, position),
            token
          )
        )
        return value ? { value, dispose: () => undefined } : null
      }
    }),
    languages.registerDefinitionProvider(selector, {
      provideDefinition: (model, position, token) =>
        locations(
          model,
          'definitionProvider',
          'textDocument/definition',
          positionParams(model, position),
          token
        )
    }),
    languages.registerDeclarationProvider(selector, {
      provideDeclaration: (model, position, token) =>
        locations(
          model,
          'declarationProvider',
          'textDocument/declaration',
          positionParams(model, position),
          token
        )
    }),
    languages.registerTypeDefinitionProvider(selector, {
      provideTypeDefinition: (model, position, token) =>
        locations(
          model,
          'typeDefinitionProvider',
          'textDocument/typeDefinition',
          positionParams(model, position),
          token
        )
    }),
    languages.registerImplementationProvider(selector, {
      provideImplementation: (model, position, token) =>
        locations(
          model,
          'implementationProvider',
          'textDocument/implementation',
          positionParams(model, position),
          token
        )
    }),
    languages.registerReferenceProvider(selector, {
      provideReferences: (model, position, context, token) =>
        locations(
          model,
          'referencesProvider',
          'textDocument/references',
          {
            ...positionParams(model, position),
            context: { includeDeclaration: context.includeDeclaration }
          },
          token
        )
    }),
    languages.registerDocumentHighlightProvider(selector, {
      async provideDocumentHighlights(model, position, token) {
        return toMonacoHighlights(
          await call<LspDocumentHighlight[]>(
            model,
            'documentHighlightProvider',
            'textDocument/documentHighlight',
            positionParams(model, position),
            token
          )
        )
      }
    }),
    languages.registerDocumentSymbolProvider(selector, {
      async provideDocumentSymbols(model, token) {
        return toMonacoSymbols(
          await call<LspDocumentSymbol[] | LspSymbolInformation[]>(
            model,
            'documentSymbolProvider',
            'textDocument/documentSymbol',
            { textDocument: { uri: model.uri.toString() } },
            token
          )
        )
      }
    })
  ]
  return { dispose: () => disposables.forEach((disposable) => disposable.dispose()) }
}
