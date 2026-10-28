import { Copy, MessageSquareQuote, X } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import {
  copyConversationReference,
  referenceConversationInFocusedChat
} from '@/components/native-chat/conversation-reference-insertion'
import type { ConversationReferenceCreate } from '../../../../shared/conversation-reference'

type Props = {
  /** The reference to the whole chat; the range narrows it. */
  source: ConversationReferenceCreate
  range: { fromItemId: string; toItemId: string; epoch: string }
  /** One-based turn numbers, for the label and the reference's title. */
  first: number
  last: number
  onClear: () => void
}

/** Under a timeline with turns picked: put a reference to just those turns where it is needed. */
export function ProjectMapTimelineRangeBar({
  source,
  range,
  first,
  last,
  onClear
}: Props): React.JSX.Element {
  const turns =
    first === last
      ? translate('projectMap.timeline.rangeOne', 'Turn {{first}}', { first })
      : translate('projectMap.timeline.rangeMany', 'Turns {{first}}–{{last}}', { first, last })
  const reference: ConversationReferenceCreate = {
    ...source,
    title: `${source.title} · ${turns}`.slice(0, 1024),
    range
  }
  return (
    <div
      data-project-map-timeline-range=""
      className="flex shrink-0 flex-col gap-1.5 border-t border-border px-2 py-2"
    >
      <div className="flex items-center gap-1 text-[11px] font-medium">
        <span className="min-w-0 flex-1 truncate">{turns}</span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={translate('projectMap.timeline.rangeClear', 'Clear the picked turns')}
          onClick={onClear}
        >
          <X />
        </Button>
      </div>
      <div className="flex gap-1">
        <Button
          variant="outline"
          size="xs"
          className="min-w-0 flex-1"
          data-project-map-timeline-range-action="reference"
          onClick={() => {
            void referenceConversationInFocusedChat(reference)
            onClear()
          }}
        >
          <MessageSquareQuote />
          <span className="truncate">
            {translate('projectMap.timeline.rangeReference', 'Reference in chat')}
          </span>
        </Button>
        <Button
          variant="outline"
          size="xs"
          data-project-map-timeline-range-action="copy"
          aria-label={translate('projectMap.timeline.rangeCopy', 'Copy reference')}
          title={translate('projectMap.timeline.rangeCopy', 'Copy reference')}
          onClick={() => {
            void copyConversationReference(reference)
            onClear()
          }}
        >
          <Copy />
        </Button>
      </div>
    </div>
  )
}
