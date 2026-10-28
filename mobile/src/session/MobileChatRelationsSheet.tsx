import { useEffect, useState } from 'react'
import {
  ArrowDownRight,
  CheckCheck,
  MessageSquare,
  SquareArrowOutUpRight,
  ArrowUpLeft,
  GitFork,
  Network,
  Quote,
  type LucideIcon
} from 'lucide-react-native'
import { ActionSheetModal, type ActionSheetAction } from '../components/ActionSheetModal'
import type { RpcClient } from '../transport/rpc-client'
import { callAgentSession } from './mobile-structured-agent-session-rpc'
import type { MobileSessionController } from './use-mobile-session-controller'
import {
  mobileChatRelationMenuActions,
  mobileChatTurnActions,
  type MobileChatRelationView
} from './mobile-chat-relation-menu'
import { markMobileChatRead, readMobileChatTurns, type MobileChatTurns } from './mobile-chat-turns'
import { canOfferMobileNativeChatCliFork } from './mobile-native-chat-cli-fork'
import {
  hostReadsReferenceRanges,
  hostRecordsChatRelations,
  hostRecordsChatReferences,
  mobileChatRelations,
  type MobileChatRelation,
  type MobileChatRelationKind
} from './mobile-chat-relations'

const ICONS: Record<MobileChatRelationKind, LucideIcon> = {
  'forked-from': ArrowUpLeft,
  'forked-into': GitFork,
  references: Quote,
  'referenced-by': ArrowDownRight
}

type Props = {
  /** The chat whose relations are shown; null keeps the sheet closed. */
  chat: { sessionId: string; title: string } | null
  client: RpcClient | null
  hostCapabilities: readonly string[] | undefined
  /** Opens a related chat this workspace has a tab for; false when it has none. */
  openChat: (sessionId: string) => boolean
  /** Whether a handoff can start from a chat of this agent here. */
  canHandoff: (agent: string) => boolean
  handoffFrom: (chat: { sessionId: string; agent: string }) => void
  onClose: () => void
}

function MobileChatRelationsSheetContent({
  chat,
  client,
  hostCapabilities,
  openChat,
  canHandoff,
  handoffFrom,
  onClose
}: Props) {
  const [view, setView] = useState<MobileChatRelationView>({ kind: 'list' })
  const [turns, setTurns] = useState<MobileChatTurns | 'failed' | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [relations, setRelations] = useState<MobileChatRelation[] | null>(null)
  const [failed, setFailed] = useState(false)
  const sessionId = chat?.sessionId ?? null
  const turnsOf = view.kind === 'turns' ? view.sessionId : null
  useEffect(() => {
    setTurns(null)
    if (!turnsOf || !client) {
      return
    }
    let cancelled = false
    readMobileChatTurns(client, turnsOf).then(
      (read) => !cancelled && setTurns(read),
      () => !cancelled && setTurns('failed')
    )
    return () => {
      cancelled = true
    }
  }, [client, turnsOf])
  useEffect(() => {
    setRelations(null)
    setFailed(false)
    if (!sessionId || !client) {
      return
    }
    let cancelled = false
    const sessionIds = [sessionId]
    void Promise.all([
      callAgentSession<unknown>(client, 'agentSession.lineage', { sessionIds }),
      hostRecordsChatReferences(hostCapabilities)
        ? callAgentSession<unknown>(client, 'agentSession.references', { sessionIds })
        : Promise.resolve(null)
    ])
      .then(([lineage, references]) => {
        if (!cancelled) {
          setRelations(
            mobileChatRelations(
              sessionId,
              { lineage, references },
              { readsRanges: hostReadsReferenceRanges(hostCapabilities) }
            )
          )
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [client, hostCapabilities, sessionId])

  // The sheet keys its rows by label, so a second chat with the same title gets a number.
  const seen = new Map<string, number>()
  const actions: ActionSheetAction[] = (relations ?? []).map((relation) => {
    const id = relation.sessionId
    const repeat = (seen.get(relation.title) ?? 0) + 1
    seen.set(relation.title, repeat)
    return {
      label: repeat > 1 ? `${relation.title} (${repeat})` : relation.title,
      hint: relation.detail,
      icon: ICONS[relation.kind],
      disabled: id === null,
      onPress: () => {
        if (id && !openChat(id)) {
          onClose()
        }
      },
      ...(id === null ? {} : { onLongPress: () => setView({ kind: 'menu', relation }) })
    }
  })
  const openOrClose = (id: string): void => {
    if (!openChat(id)) {
      onClose()
    }
  }
  const back: ActionSheetAction = {
    label: 'Back',
    icon: ArrowUpLeft,
    skipAutoClose: true,
    onPress: () => {
      setView({ kind: 'list' })
      setNote(null)
    }
  }
  if (view.kind === 'menu' && view.relation.sessionId) {
    const { relation } = view
    const id = view.relation.sessionId
    const agent = relation.agent
    const menu = mobileChatRelationMenuActions({
      relation,
      hostCapabilities,
      open: () => openOrClose(id),
      showTurns: () => setView({ kind: 'turns', sessionId: id, title: relation.title }),
      markRead: () => {
        if (client) {
          void markMobileChatRead(client, id).then(
            (done) => setNote(done ? 'Marked as read.' : 'Nothing to mark as read.'),
            () => setNote('Could not mark this chat as read.')
          )
        }
      },
      handoff: agent && canHandoff(agent) ? () => handoffFrom({ sessionId: id, agent }) : null
    })
    const menuIcons: Record<string, LucideIcon> = {
      Open: SquareArrowOutUpRight,
      Turns: MessageSquare,
      'Mark as read': CheckCheck,
      'Hand off': GitFork
    }
    return (
      <ActionSheetModal
        visible={chat !== null}
        title={relation.title}
        message={note ?? relation.detail}
        actions={[...menu.map((action) => ({ ...action, icon: menuIcons[action.label] })), back]}
        onClose={onClose}
      />
    )
  }
  if (view.kind === 'turns') {
    const id = view.sessionId
    const turnMessage =
      turns === 'failed'
        ? 'Could not read this chat’s turns from its host.'
        : turns === null
          ? 'Reading turns…'
          : turns.turns.length === 0
            ? 'No turns yet.'
            : turns.omitted > 0
              ? `Showing the newest turns; ${turns.omitted} older left out. Tap one to open the chat.`
              : 'Tap a turn to open the chat.'
    return (
      <ActionSheetModal
        visible={chat !== null}
        title={`Turns · ${view.title}`}
        message={turnMessage}
        actions={[
          ...(turns && turns !== 'failed'
            ? mobileChatTurnActions(turns.turns, () => openOrClose(id))
            : []),
          back
        ]}
        onClose={onClose}
      />
    )
  }
  const message = failed
    ? 'Could not read this chat’s relations from its host.'
    : relations === null
      ? 'Reading relations…'
      : relations.length === 0
        ? 'No handoffs, and no references sent or received.'
        : 'Tap a chat open in this workspace to switch to it. Hold a row for more.'
  return (
    <ActionSheetModal
      visible={chat !== null}
      title={chat ? `Relations · ${chat.title}` : undefined}
      message={message}
      actions={actions}
      onClose={onClose}
    />
  )
}

/**
 * A chat tab's Relations action and the sheet it opens. The project map's canvas is a desktop
 * surface; a phone lists the same relations under the chat, and a tap opens one open here.
 */
export function useMobileChatRelations(
  controller: Pick<
    MobileSessionController,
    'client' | 'hostCapabilities' | 'sessionTabs' | 'switchSessionTab' | 'handleCreateTerminal'
  >,
  workspaceOnPairedHost: boolean
) {
  const { client, hostCapabilities, sessionTabs, switchSessionTab, handleCreateTerminal } =
    controller
  const [chat, setChat] = useState<{ sessionId: string; title: string } | null>(null)
  const actionsFor = (tab: { sessionId: string; title?: string } | null): ActionSheetAction[] =>
    tab && hostRecordsChatRelations(hostCapabilities)
      ? [
          {
            label: 'Relations',
            hint: 'Forks and references, as on the project map',
            icon: Network,
            closeBeforePress: true,
            onPress: () => setChat({ sessionId: tab.sessionId, title: tab.title || 'Chat' })
          }
        ]
      : []
  const sheet = (
    <MobileChatRelationsSheet
      chat={chat}
      client={client}
      hostCapabilities={hostCapabilities}
      openChat={(sessionId) => {
        const tab = sessionTabs.find(
          (candidate) => candidate.type === 'agent-session' && candidate.sessionId === sessionId
        )
        if (!tab) {
          return false
        }
        setChat(null)
        switchSessionTab(tab)
        return true
      }}
      canHandoff={(agent) =>
        canOfferMobileNativeChatCliFork({ agent, hostCapabilities, workspaceOnPairedHost })
      }
      handoffFrom={(source) => {
        setChat(null)
        void handleCreateTerminal(undefined, { sourceChatFork: source })
      }}
      onClose={() => setChat(null)}
    />
  )
  return { actionsFor, sheet }
}

/** Keyed by chat so a second chat never opens on the first one's menu or turns. */
export function MobileChatRelationsSheet(props: Props) {
  return <MobileChatRelationsSheetContent key={props.chat?.sessionId ?? ''} {...props} />
}
