import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { ParsedHandoffMessage } from '../../../../shared/agent-session-handoff-text'
import { NativeChatMarkdown } from './NativeChatMarkdown'
import { NativeChatCodeBlock } from './NativeChatCodeBlock'

function dividerLabel(handoff: ParsedHandoffMessage): string {
  const from = handoff.sourceLabels.join('、')
  if (handoff.kind === 'summary') {
    return from
      ? translate(
          'components.native-chat.handoff.compactedFrom',
          'Handed off from {{from}}, compacted',
          {
            from
          }
        )
      : translate('components.native-chat.handoff.compacted', 'Handed off, compacted')
  }
  return from
    ? translate('components.native-chat.handoff.from', 'Handed off from {{from}}', { from })
    : translate('components.native-chat.handoff.plain', 'Handed off')
}

function disclosureLabel(handoff: ParsedHandoffMessage): string {
  if (handoff.kind === 'summary') {
    return translate('components.native-chat.handoff.summary', 'Summary handed over')
  }
  return handoff.handedOver
    ? translate(
        'components.native-chat.handoff.messagesCounted',
        '{{count}} of {{total}} messages handed over',
        handoff.handedOver
      )
    : translate('components.native-chat.handoff.messages', 'Messages handed over')
}

/**
 * The first message of a hand-off child: a divider like a compaction's, and the carried context
 * folded under it, so the chat opens on the person's instruction rather than a wall of history.
 */
export function NativeChatHandoffRow({
  handoff,
  messageId,
  instruction
}: {
  handoff: ParsedHandoffMessage
  messageId: string
  /** The person's instruction, drawn as their own message under the divider. */
  instruction: React.ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const label = dividerLabel(handoff)
  return (
    <div className="flex flex-col gap-2" data-native-chat-handoff={handoff.kind}>
      <div
        role="separator"
        aria-label={label}
        className="flex items-center gap-3 py-2 text-xs text-chat-foreground-faint"
      >
        <span className="h-px flex-1 bg-border" />
        <span className="max-w-[70%] truncate">{label}</span>
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className="flex flex-col items-center">
        <button
          type="button"
          aria-expanded={open}
          data-native-chat-handoff-toggle=""
          onClick={() => setOpen((value) => !value)}
          className="flex items-center gap-1 rounded-md px-2 py-0.5 text-xs text-chat-foreground-faint hover:bg-accent/50 hover:text-chat-foreground"
        >
          <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
          <span>{disclosureLabel(handoff)}</span>
        </button>
        {open ? (
          <div
            data-native-chat-handoff-context=""
            className="mt-1 max-h-96 w-full overflow-y-auto rounded-lg border border-border bg-muted/40 px-3.5 py-2.5 text-chat-foreground scrollbar-sleek"
          >
            {handoff.kind === 'summary' ? (
              <NativeChatMarkdown
                rowKey={`${messageId}:handoff`}
                content={handoff.context}
                variant="document"
                className="text-sm"
                renderCodeBlock={NativeChatCodeBlock}
              />
            ) : (
              <pre className="whitespace-pre-wrap break-words font-mono text-xs">
                {handoff.context}
              </pre>
            )}
          </div>
        ) : null}
      </div>
      {instruction}
    </div>
  )
}
