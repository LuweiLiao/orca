// A saved review note goes, unsent, to the chat the user worked in last, with no target to pick.
import type { JSONContent } from '@tiptap/react'
import { useAppStore } from '@/store'
import { getStructuredChatTabNames } from '@/runtime/native-chat/naming/structured-chat-name-observation'
import type { DiffCommentOwner } from '@/store/slices/diff-comments/diff-comment-owner'
import { deriveNotesSendAgentTargets } from '@/lib/agent-session/messaging/notes-send-agent-targets'
import { formatDiffComment } from '../../../../../shared/file-review/diff-comments-format'
import type { DiffComment } from '../../../../../shared/file-review/diff-comment-types'
import {
  readNativeChatComposerDraft,
  updateNativeChatComposerDraft
} from '../drafts/native-chat-composer-draft-store'
import { promptDocumentText, withReviewNoteInDocument } from '../review-notes/review-notes-document'
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

/** Adds the note to the draft's one review-notes block, which the composer shows as a pill. */
function addNoteToChatDraft(scopeKey: string, note: string): void {
  const add = <Draft extends { text: string; document?: JSONContent }>(draft: Draft): Draft => {
    const document = withReviewNoteInDocument(draft.document, draft.text, note)
    return { ...draft, text: promptDocumentText(document), document }
  }
  const next = add(readNativeChatComposerDraft(scopeKey))
  updateNativeChatComposerDraft(
    scopeKey,
    { text: next.text, document: next.document },
    'immediate',
    // Drafts not loaded yet: the same addition over the saved draft once it loads.
    add
  )
}

/**
 * Adds the note to that chat's draft without showing the chat, so reviewing goes on where it
 * is. False when the workspace has no chat that can take it; the note then waits to be sent.
 */
export function addNoteToLastFocusedChat(owner: DiffCommentOwner, note: DiffComment): boolean {
  const scopeKey = lastFocusedChatScopeKey(note.worktreeId)
  if (!scopeKey) {
    return false
  }
  addNoteToChatDraft(scopeKey, formatDiffComment(note))
  // Marked sent so the note is not offered again from the send menus.
  void useAppStore.getState().markDiffCommentsSent(owner, [note.id])
  return true
}
