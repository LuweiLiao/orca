// A saved review note goes, unsent, to the chat the user worked in last, with no target to pick.
import { useAppStore } from '@/store'
import { getStructuredChatTabNames } from '@/runtime/native-chat/naming/structured-chat-name-observation'
import type { DiffCommentOwner } from '@/store/slices/diff-comments/diff-comment-owner'
import { deriveNotesSendAgentTargets } from '@/lib/agent-session/messaging/notes-send-agent-targets'
import { formatDiffComments } from '../../../../../shared/file-review/diff-comments-format'
import type { DiffComment } from '../../../../../shared/file-review/diff-comment-types'
import { appendQuoteToChatDraft } from '../drafts/native-chat-selection-quote-draft'
import { workspaceChatTargetFor } from './native-chat-workspace-selection'

/** The composer of the workspace chat focused last among those that can take text. */
function lastFocusedChatScopeKey(worktreeId: string): string | null {
  const state = useAppStore.getState()
  let best: { scopeKey: string; focusedAt: number } | null = null
  for (const target of deriveNotesSendAgentTargets(
    state,
    worktreeId,
    getStructuredChatTabNames()
  )) {
    if (target.status !== 'eligible') {
      continue
    }
    const chat = workspaceChatTargetFor(state, worktreeId, target.messageTarget)
    const focusedAt = chat?.tab.lastFocusedAt ?? 0
    if (chat && (!best || focusedAt > best.focusedAt)) {
      best = { scopeKey: chat.scopeKey, focusedAt }
    }
  }
  return best?.scopeKey ?? null
}

/**
 * Appends the note to that chat's draft without showing the chat, so reviewing goes on where it
 * is. False when the workspace has no chat that can take it; the note then waits to be sent.
 */
export function addNoteToLastFocusedChat(owner: DiffCommentOwner, note: DiffComment): boolean {
  const scopeKey = lastFocusedChatScopeKey(note.worktreeId)
  if (!scopeKey) {
    return false
  }
  appendQuoteToChatDraft(scopeKey, formatDiffComments([note]))
  // Marked sent so the note is not offered again from the send menus.
  void useAppStore.getState().markDiffCommentsSent(owner, [note.id])
  return true
}
