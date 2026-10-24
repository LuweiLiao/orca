export const STRUCTURED_AGENT_SESSION_DRAFT_SCOPE_PREFIX = 'agent-session:'

export function structuredAgentSessionDraftScopeKey(sessionId: string): string {
  return `${STRUCTURED_AGENT_SESSION_DRAFT_SCOPE_PREFIX}${sessionId}`
}

export function structuredAgentSessionIdOfDraftScope(scopeKey: string): string | null {
  return scopeKey.startsWith(STRUCTURED_AGENT_SESSION_DRAFT_SCOPE_PREFIX)
    ? scopeKey.slice(STRUCTURED_AGENT_SESSION_DRAFT_SCOPE_PREFIX.length)
    : null
}

/** Pane keys end with a leaf UUID; a tab id may contain colons. */
export function nativeChatDraftScopeTabId(scopeKey: string): string {
  return scopeKey.slice(0, scopeKey.lastIndexOf(':'))
}
