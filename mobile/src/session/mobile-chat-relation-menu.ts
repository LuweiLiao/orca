import type { ActionSheetAction } from '../components/ActionSheetModal'
import type { MobileChatRelation } from './mobile-chat-relations'
import {
  hostAcknowledgesChatAttention,
  hostReadsChatTurns,
  type MobileChatTurn
} from './mobile-chat-turns'

export type MobileChatRelationView =
  | { kind: 'list' }
  | { kind: 'menu'; relation: MobileChatRelation }
  | { kind: 'turns'; sessionId: string; title: string }

/** What a held relation row offers; each entry is absent when this host or workspace cannot do it. */
export function mobileChatRelationMenuActions(args: {
  relation: MobileChatRelation
  hostCapabilities: readonly string[] | undefined
  open: () => void
  showTurns: () => void
  markRead: () => void
  /** Null when no handoff can start from this chat here. */
  handoff: (() => void) | null
}): ActionSheetAction[] {
  const { relation, hostCapabilities } = args
  if (relation.sessionId === null) {
    return []
  }
  const actions: ActionSheetAction[] = [{ label: 'Open', skipAutoClose: true, onPress: args.open }]
  if (hostReadsChatTurns(hostCapabilities)) {
    actions.push({
      label: 'Turns',

      skipAutoClose: true,
      onPress: args.showTurns
    })
    if (hostAcknowledgesChatAttention(hostCapabilities)) {
      actions.push({
        label: 'Mark as read',

        skipAutoClose: true,
        onPress: args.markRead
      })
    }
  }
  if (args.handoff) {
    actions.push({ label: 'Hand off', skipAutoClose: true, onPress: args.handoff })
  }
  return actions
}

export function mobileChatTurnActions(
  turns: readonly MobileChatTurn[],
  open: (turn: MobileChatTurn) => void
): ActionSheetAction[] {
  return turns.map((turn) => ({
    label: `${turn.number}. ${turn.preview}`,
    ...(turn.reply ? { hint: turn.reply } : {}),
    skipAutoClose: true,
    onPress: () => open(turn)
  }))
}
