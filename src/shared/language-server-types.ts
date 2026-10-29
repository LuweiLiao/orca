/** The language servers Orca knows how to start; each owns a set of Monaco language ids. */
export type LanguageServerId = 'clangd' | 'pyright' | 'rust-analyzer' | 'typescript'

export const LANGUAGE_SERVER_IDS: readonly LanguageServerId[] = [
  'clangd',
  'pyright',
  'rust-analyzer',
  'typescript'
]

export function isLanguageServerId(value: unknown): value is LanguageServerId {
  return typeof value === 'string' && LANGUAGE_SERVER_IDS.some((id) => id === value)
}

export type LanguageServerStartArgs = {
  serverId: LanguageServerId
  /** The workspace root the server indexes; must be a registered local workspace. */
  rootPath: string
}

export type LanguageServerStartResult =
  | { ok: true; sessionId: string }
  /** `missing`: the server program is not installed (or not on the login PATH). */
  | { ok: false; reason: 'missing' | 'unauthorized' | 'failed'; message: string }

export type LanguageServerMessageEvent = { sessionId: string; message: unknown }

export type LanguageServerExitEvent = {
  sessionId: string
  code: number | null
  /** The last lines the server wrote to stderr, for a crash notice. */
  stderrTail: string
}
