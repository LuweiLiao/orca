import { useEffect, useRef, useState } from 'react'
import { MessageCircle, Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { NativeChatPromptPillRemoveButton } from './NativeChatPromptPillRemoveButton'
import { Badge } from '@/components/ui/badge'
import { translate } from '@/i18n/i18n'
import {
  conversationReferenceSnapshotCount,
  type ConversationReference,
  type ConversationReferenceMessage
} from '../../../../shared/conversation-reference'

export function NativeChatConversationReference({
  uri,
  title,
  selected = false,
  onRemove,
  onReplace
}: {
  uri: string
  title: string
  selected?: boolean
  onRemove?: () => void
  /** Present in a draft: the pill swaps in a reference that follows its chat, or pins it. */
  onReplace?: (reference: ConversationReference) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ConversationReferenceMessage[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const generation = useRef(0)
  const [switching, setSwitching] = useState(false)
  const follow = async (mode: 'live' | 'snapshot'): Promise<void> => {
    setSwitching(true)
    setError(null)
    try {
      const next = await window.api.aiVault.retargetConversationReference({
        reference: uri,
        follow: mode
      })
      onReplace?.(next)
      setOpen(false)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setSwitching(false)
    }
  }
  const snapshotCount = conversationReferenceSnapshotCount(uri)
  const snapshotLabel =
    snapshotCount === null
      ? null
      : translate(
          'components.native-chat.conversationReference.snapshot',
          'Snapshot through message {{count}}',
          { count: snapshotCount }
        )
  const load = async (next?: string): Promise<void> => {
    const request = ++generation.current
    setLoading(true)
    setError(null)
    try {
      const page = await window.api.aiVault.readConversationReference({
        reference: uri,
        ...(next ? { cursor: next } : {})
      })
      if (generation.current !== request) {
        return
      }
      setMessages((current) => (next ? [...current, ...page.messages] : page.messages))
      setCursor(page.nextCursor)
      setWarnings(page.warnings)
    } catch (failure) {
      if (generation.current === request) {
        setError(failure instanceof Error ? failure.message : String(failure))
      }
    } finally {
      if (generation.current === request) {
        setLoading(false)
      }
    }
  }
  useEffect(
    () => () => {
      generation.current++
    },
    []
  )
  return (
    <>
      <Badge variant="promptPill" data-selected={selected}>
        <button
          type="button"
          className="inline-flex min-w-0 items-center gap-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-native-chat-conversation-reference={uri}
          title={snapshotLabel ? `${title}\n${snapshotLabel}` : title}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            setOpen(true)
            void load()
          }}
        >
          <MessageCircle aria-hidden="true" className="size-3 shrink-0" />
          <span className="truncate">{title}</span>
          {snapshotCount === null ? (
            onReplace ? (
              <span className="shrink-0 text-muted-foreground">
                {translate('components.native-chat.conversationReference.liveShort', 'live')}
              </span>
            ) : null
          ) : (
            <span className="shrink-0 text-muted-foreground tabular-nums">#{snapshotCount}</span>
          )}
        </button>
        {onRemove ? (
          <NativeChatPromptPillRemoveButton
            label={translate(
              'components.native-chat.conversationReference.remove',
              'Remove conversation reference'
            )}
            onRemove={onRemove}
          />
        ) : null}
      </Badge>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value)
          if (!value) {
            generation.current++
          }
        }}
      >
        <DialogContent className="max-h-[80vh] sm:max-w-2xl" scrollable>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {translate(
                'components.native-chat.conversationReference.source',
                'Referenced conversation'
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            {messages.map((message) => (
              <div
                key={`${message.messageIndex}:${message.textOffset}`}
                className="space-y-1 border-b border-border pb-3"
              >
                <div className="text-xs font-medium text-muted-foreground">
                  {message.role === 'user'
                    ? translate('components.native-chat.conversationReference.user', 'User')
                    : message.role === 'assistant'
                      ? translate(
                          'components.native-chat.conversationReference.assistant',
                          'Assistant'
                        )
                      : translate('components.native-chat.conversationReference.tool', 'Tool')}
                </div>
                <div className="whitespace-pre-wrap break-words select-text">{message.text}</div>
              </div>
            ))}
            {warnings.map((warning) => (
              <p key={warning} className="text-xs text-muted-foreground">
                {warning}
              </p>
            ))}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            {loading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2
                  aria-hidden="true"
                  className="size-4 animate-spin motion-reduce:animate-none"
                />
                {translate(
                  'components.native-chat.conversationReference.loading',
                  'Reading conversation'
                )}
              </div>
            ) : null}
            {!loading && !error && messages.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {translate(
                  'components.native-chat.conversationReference.empty',
                  'This conversation has no readable text.'
                )}
              </p>
            ) : null}
            {onReplace ? (
              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
                <span className="flex-1">
                  {snapshotCount === null
                    ? translate(
                        'components.native-chat.conversationReference.liveNote',
                        'Follows the chat: the agent reads it as it is when it reads it.'
                      )
                    : (snapshotLabel ?? '')}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={switching}
                  onClick={() => void follow(snapshotCount === null ? 'snapshot' : 'live')}
                >
                  {snapshotCount === null
                    ? translate(
                        'components.native-chat.conversationReference.pinNow',
                        'Pin it where it is now'
                      )
                    : translate(
                        'components.native-chat.conversationReference.followLive',
                        'Follow the chat as it goes on'
                      )}
                </Button>
              </div>
            ) : null}
            {!loading && (cursor || error) ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void load(error ? undefined : (cursor ?? undefined))}
              >
                {error
                  ? translate('components.native-chat.conversationReference.retry', 'Retry')
                  : translate('components.native-chat.conversationReference.more', 'Load more')}
              </Button>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
