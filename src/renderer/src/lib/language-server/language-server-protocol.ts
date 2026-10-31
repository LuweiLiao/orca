// The slice of the Language Server Protocol Orca speaks; only the fields read are typed.
export type LspPosition = { line: number; character: number }
export type LspRange = { start: LspPosition; end: LspPosition }
export type LspLocation = { uri: string; range: LspRange }
export type LspLocationLink = {
  targetUri: string
  targetRange: LspRange
  targetSelectionRange: LspRange
  originSelectionRange?: LspRange
}
export type LspMarkupContent = { kind: 'markdown' | 'plaintext'; value: string }
export type LspMarkedString = string | { language: string; value: string }
export type LspTextEdit = { range: LspRange; newText: string }
export type LspInsertReplaceEdit = { newText: string; insert: LspRange; replace: LspRange }

export type LspCompletionItem = {
  label: string | { label: string; detail?: string; description?: string }
  kind?: number
  tags?: number[]
  detail?: string
  documentation?: string | LspMarkupContent
  deprecated?: boolean
  preselect?: boolean
  sortText?: string
  filterText?: string
  insertText?: string
  /** 2 = snippet. */
  insertTextFormat?: number
  textEdit?: LspTextEdit | LspInsertReplaceEdit
  additionalTextEdits?: LspTextEdit[]
  commitCharacters?: string[]
  data?: unknown
}
export type LspCompletionList = { isIncomplete: boolean; items: LspCompletionItem[] }

export type LspHover = {
  contents: LspMarkupContent | LspMarkedString | LspMarkedString[]
  range?: LspRange
}

export type LspSignatureHelp = {
  signatures: {
    label: string
    documentation?: string | LspMarkupContent
    parameters?: { label: string | [number, number]; documentation?: string | LspMarkupContent }[]
    activeParameter?: number
  }[]
  activeSignature?: number
  activeParameter?: number
}

export type LspDocumentSymbol = {
  name: string
  detail?: string
  kind: number
  tags?: number[]
  range: LspRange
  selectionRange: LspRange
  children?: LspDocumentSymbol[]
}
export type LspSymbolInformation = {
  name: string
  kind: number
  tags?: number[]
  containerName?: string
  location: LspLocation
}

export type LspDocumentHighlight = { range: LspRange; kind?: number }

export type LspDiagnostic = {
  range: LspRange
  /** 1 error, 2 warning, 3 information, 4 hint. */
  severity?: number
  code?: number | string
  codeDescription?: { href: string }
  source?: string
  message: string
  /** 1 unnecessary, 2 deprecated. */
  tags?: number[]
  relatedInformation?: { location: LspLocation; message: string }[]
}

export type LspServerCapabilities = {
  /** 1 full, 2 incremental; or an options object with `change`. */
  textDocumentSync?: number | { openClose?: boolean; change?: number; save?: boolean | object }
  completionProvider?: { triggerCharacters?: string[]; resolveProvider?: boolean }
  hoverProvider?: boolean | object
  signatureHelpProvider?: { triggerCharacters?: string[]; retriggerCharacters?: string[] }
  definitionProvider?: boolean | object
  declarationProvider?: boolean | object
  typeDefinitionProvider?: boolean | object
  implementationProvider?: boolean | object
  referencesProvider?: boolean | object
  documentHighlightProvider?: boolean | object
  documentSymbolProvider?: boolean | object
}
