import { registerLanguageServerProviders } from './language-server-providers'

let registered = false

/** Registers the language server providers once, when the first code editor renders. */
export function ensureLanguageServerProviders(): void {
  if (registered || typeof window === 'undefined' || !window.api?.languageServer) {
    return
  }
  registered = true
  registerLanguageServerProviders()
}
