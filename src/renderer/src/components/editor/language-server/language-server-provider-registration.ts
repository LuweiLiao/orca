import { languages } from 'monaco-editor'
import {
  conf as typescriptConf,
  language as typescriptTokens
} from 'monaco-editor/esm/vs/basic-languages/typescript/typescript.js'
import {
  conf as javascriptConf,
  language as javascriptTokens
} from 'monaco-editor/esm/vs/basic-languages/javascript/javascript.js'
import { registerLanguageServerProviders } from './language-server-providers'
import { LANGUAGE_SERVER_OWNED_LANGUAGES } from './language-server-routing'

let registered = false

/** The grammar of the built-in TypeScript/JavaScript ids, without Monaco's built-in service. */
function registerOwnedLanguages(): void {
  const grammar = {
    typescript: { conf: typescriptConf, tokens: typescriptTokens },
    javascript: { conf: javascriptConf, tokens: javascriptTokens }
  }
  for (const [base, id] of Object.entries(LANGUAGE_SERVER_OWNED_LANGUAGES)) {
    const source = base === 'typescript' ? grammar.typescript : grammar.javascript
    languages.register({ id })
    languages.setLanguageConfiguration(id, source.conf)
    languages.setMonarchTokensProvider(id, source.tokens)
  }
}

/** Registers the language server providers once, when the first code editor renders. */
export function ensureLanguageServerProviders(): void {
  if (registered || typeof window === 'undefined' || !window.api?.languageServer) {
    return
  }
  registered = true
  registerOwnedLanguages()
  registerLanguageServerProviders()
}
