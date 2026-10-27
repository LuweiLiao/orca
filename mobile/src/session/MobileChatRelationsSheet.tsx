import { useEffect, useState } from 'react'
import {
  ArrowDownRight,
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
  onClose: () => void
}

export function MobileChatRelationsSheet({
  chat,
  client,
  hostCapabilities,
  openChat,
  onClose
}: Props) {
  const [relations, setRelations] = useState<MobileChatRelation[] | null>(null)
  const [failed, setFailed] = useState(false)
  const sessionId = chat?.sessionId ?? null
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
          setRelations(mobileChatRelations(sessionId, { lineage, references }))
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
      }
    }
  })
  const message = failed
    ? 'Could not read this chat’s relations from its host.'
    : relations === null
      ? 'Reading relations…'
      : relations.length === 0
        ? 'Not forked, and no references sent or received.'
        : 'Tap a chat open in this workspace to switch to it.'
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
    'client' | 'hostCapabilities' | 'sessionTabs' | 'switchSessionTab'
  >
) {
  const { client, hostCapabilities, sessionTabs, switchSessionTab } = controller
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
      onClose={() => setChat(null)}
    />
  )
  return { actionsFor, sheet }
}
