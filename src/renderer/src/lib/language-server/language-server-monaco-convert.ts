import {
  languages,
  MarkerSeverity,
  MarkerTag,
  Range,
  Uri,
  type editor,
  type IMarkdownString
} from 'monaco-editor'
import type {
  LspCompletionItem,
  LspDiagnostic,
  LspDocumentHighlight,
  LspDocumentSymbol,
  LspHover,
  LspLocation,
  LspLocationLink,
  LspMarkedString,
  LspMarkupContent,
  LspPosition,
  LspRange,
  LspSignatureHelp,
  LspSymbolInformation
} from './language-server-protocol'

// LSP positions are 0-based; Monaco's are 1-based. Both count UTF-16 code units.
export function toLspPosition(position: { lineNumber: number; column: number }): LspPosition {
  return { line: position.lineNumber - 1, character: position.column - 1 }
}

export function toMonacoRange(range: LspRange): Range {
  return new Range(
    range.start.line + 1,
    range.start.character + 1,
    range.end.line + 1,
    range.end.character + 1
  )
}

export function toLspRange(range: {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}): LspRange {
  return {
    start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
    end: { line: range.endLineNumber - 1, character: range.endColumn - 1 }
  }
}

export function toMarkdown(
  value: string | LspMarkupContent | LspMarkedString | undefined
): IMarkdownString | undefined {
  if (value === undefined || value === '') {
    return undefined
  }
  if (typeof value === 'string') {
    return { value: escapeMarkdown(value) }
  }
  if ('kind' in value) {
    return { value: value.kind === 'markdown' ? value.value : escapeMarkdown(value.value) }
  }
  return { value: `\`\`\`${value.language}\n${value.value}\n\`\`\`` }
}

function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!<>|]/g, '\\$&')
}

export function toMonacoHover(hover: LspHover | null): languages.Hover | null {
  if (!hover) {
    return null
  }
  const parts = Array.isArray(hover.contents) ? hover.contents : [hover.contents]
  const contents = parts.flatMap((part) => toMarkdown(part) ?? [])
  return contents.length
    ? { contents, range: hover.range ? toMonacoRange(hover.range) : undefined }
    : null
}

const COMPLETION_KIND_NAMES = [
  'Text',
  'Method',
  'Function',
  'Constructor',
  'Field',
  'Variable',
  'Class',
  'Interface',
  'Module',
  'Property',
  'Unit',
  'Value',
  'Enum',
  'Keyword',
  'Snippet',
  'Color',
  'File',
  'Reference',
  'Folder',
  'EnumMember',
  'Constant',
  'Struct',
  'Event',
  'Operator',
  'TypeParameter'
] as const

function completionKind(kind: number | undefined): languages.CompletionItemKind {
  const name = kind === undefined ? undefined : COMPLETION_KIND_NAMES[kind - 1]
  return name ? languages.CompletionItemKind[name] : languages.CompletionItemKind.Text
}

/** One completion item, its replace range defaulting to the word at the cursor. */
export function toMonacoCompletion(
  item: LspCompletionItem,
  wordRange: Range
): languages.CompletionItem {
  const label = typeof item.label === 'string' ? item.label : item.label.label
  const edit = item.textEdit
  const range = !edit
    ? wordRange
    : 'range' in edit
      ? toMonacoRange(edit.range)
      : { insert: toMonacoRange(edit.insert), replace: toMonacoRange(edit.replace) }
  const deprecated = item.deprecated || item.tags?.includes(1)
  return {
    label:
      typeof item.label === 'string'
        ? label
        : { label, detail: item.label.detail, description: item.label.description },
    kind: completionKind(item.kind),
    detail: item.detail,
    documentation: toMarkdown(item.documentation),
    sortText: item.sortText,
    filterText: item.filterText,
    preselect: item.preselect,
    insertText: edit?.newText ?? item.insertText ?? label,
    insertTextRules:
      item.insertTextFormat === 2
        ? languages.CompletionItemInsertTextRule.InsertAsSnippet
        : undefined,
    range,
    commitCharacters: item.commitCharacters,
    additionalTextEdits: item.additionalTextEdits?.map((textEdit) => ({
      range: toMonacoRange(textEdit.range),
      text: textEdit.newText
    })),
    tags: deprecated ? [languages.CompletionItemTag.Deprecated] : undefined
  }
}

export function toMonacoSignatureHelp(
  help: LspSignatureHelp | null
): languages.SignatureHelp | null {
  if (!help || help.signatures.length === 0) {
    return null
  }
  return {
    activeSignature: help.activeSignature ?? 0,
    activeParameter: help.activeParameter ?? help.signatures[0]?.activeParameter ?? 0,
    signatures: help.signatures.map((signature) => ({
      label: signature.label,
      documentation: toMarkdown(signature.documentation),
      activeParameter: signature.activeParameter,
      parameters: (signature.parameters ?? []).map((parameter) => ({
        label: parameter.label,
        documentation: toMarkdown(parameter.documentation)
      }))
    }))
  }
}

export function toMonacoLocations(
  result: LspLocation | LspLocation[] | LspLocationLink[] | null
): languages.LocationLink[] {
  if (!result) {
    return []
  }
  return (Array.isArray(result) ? result : [result]).map((entry) =>
    'targetUri' in entry
      ? {
          uri: Uri.parse(entry.targetUri),
          range: toMonacoRange(entry.targetRange),
          targetSelectionRange: toMonacoRange(entry.targetSelectionRange),
          originSelectionRange: entry.originSelectionRange
            ? toMonacoRange(entry.originSelectionRange)
            : undefined
        }
      : { uri: Uri.parse(entry.uri), range: toMonacoRange(entry.range) }
  )
}

function symbolKind(kind: number): languages.SymbolKind {
  // Monaco's SymbolKind is LSP's, shifted to start at 0.
  return kind >= 1 && kind <= 26 ? kind - 1 : languages.SymbolKind.Variable
}

export function toMonacoSymbols(
  result: LspDocumentSymbol[] | LspSymbolInformation[] | null
): languages.DocumentSymbol[] {
  const convert = (symbol: LspDocumentSymbol): languages.DocumentSymbol => ({
    name: symbol.name,
    detail: symbol.detail ?? '',
    kind: symbolKind(symbol.kind),
    tags: symbol.tags?.includes(1) ? [languages.SymbolTag.Deprecated] : [],
    range: toMonacoRange(symbol.range),
    selectionRange: toMonacoRange(symbol.selectionRange),
    children: symbol.children?.map(convert)
  })
  return (result ?? []).map((symbol) =>
    'location' in symbol
      ? {
          name: symbol.name,
          detail: '',
          containerName: symbol.containerName,
          kind: symbolKind(symbol.kind),
          tags: [],
          range: toMonacoRange(symbol.location.range),
          selectionRange: toMonacoRange(symbol.location.range)
        }
      : convert(symbol)
  )
}

export function toMonacoHighlights(
  result: LspDocumentHighlight[] | null
): languages.DocumentHighlight[] {
  return (result ?? []).map((highlight) => ({
    range: toMonacoRange(highlight.range),
    kind:
      highlight.kind === 3
        ? languages.DocumentHighlightKind.Write
        : highlight.kind === 2
          ? languages.DocumentHighlightKind.Read
          : languages.DocumentHighlightKind.Text
  }))
}

const SEVERITIES = [
  MarkerSeverity.Error,
  MarkerSeverity.Warning,
  MarkerSeverity.Info,
  MarkerSeverity.Hint
]

export function toMonacoMarker(diagnostic: LspDiagnostic): editor.IMarkerData {
  const range = toMonacoRange(diagnostic.range)
  const tags = [
    ...(diagnostic.tags?.includes(1) ? [MarkerTag.Unnecessary] : []),
    ...(diagnostic.tags?.includes(2) ? [MarkerTag.Deprecated] : [])
  ]
  return {
    ...range,
    severity: SEVERITIES[(diagnostic.severity ?? 1) - 1] ?? MarkerSeverity.Error,
    message: diagnostic.message,
    source: diagnostic.source,
    code:
      diagnostic.code === undefined
        ? undefined
        : diagnostic.codeDescription
          ? { value: String(diagnostic.code), target: Uri.parse(diagnostic.codeDescription.href) }
          : String(diagnostic.code),
    tags: tags.length ? tags : undefined,
    relatedInformation: diagnostic.relatedInformation?.map((related) => ({
      resource: Uri.parse(related.location.uri),
      message: related.message,
      ...toMonacoRange(related.location.range)
    }))
  }
}
