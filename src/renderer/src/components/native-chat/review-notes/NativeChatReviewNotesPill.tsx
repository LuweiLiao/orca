import { useState } from 'react'
import { MessageSquare, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { nativeChatAnnotationCopy } from '../annotations/native-chat-annotation-copy'
import { reviewNoteSummary } from './review-note-summary'

/**
 * Review notes from documents folded into one "N notes" pill; it opens to list each note, which
 * a draft can delete. The notes themselves still go to the agent in full.
 */
export function NativeChatReviewNotesPill({
  entries,
  selected = false,
  onRemoveEntry
}: {
  entries: readonly string[]
  selected?: boolean
  /** Present in a draft: deleting the last note removes the pill. */
  onRemoveEntry?: (index: number) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const copy = nativeChatAnnotationCopy()
  const label = copy.count(entries.length)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size="xs"
          data-native-chat-review-notes={entries.length}
          data-selected={selected || undefined}
          className="max-w-full align-baseline data-[selected]:ring-2 data-[selected]:ring-ring"
          aria-label={label}
          // Keeps the composer's caret and selection where they are.
          onMouseDown={(event) => event.preventDefault()}
        >
          <MessageSquare />
          <span className="truncate">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        aria-label={copy.title}
        role="region"
        align="start"
        side="top"
        collisionPadding={12}
        className="w-96 max-w-[calc(100vw-1.5rem)]"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <ol className="scrollbar-sleek max-h-72 divide-y divide-border overflow-y-auto overscroll-contain p-2 text-sm">
          {entries.map((entry, index) => {
            const note = reviewNoteSummary(entry)
            return (
              <li key={`${index}:${entry.length}`} className="py-2" data-native-chat-review-note="">
                <div className="flex items-start gap-2">
                  <span className="pt-0.5 text-xs text-muted-foreground">{index + 1}.</span>
                  <div className="min-w-0 flex-1">
                    <p
                      className="truncate text-xs font-medium text-muted-foreground"
                      title={note.file}
                    >
                      {note.location}
                    </p>
                    {note.excerpt ? (
                      <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words border-l-2 border-border pl-2 text-xs text-muted-foreground">
                        {note.excerpt}
                      </p>
                    ) : null}
                    <p className="mt-1 whitespace-pre-wrap break-words">{note.comment}</p>
                  </div>
                  {onRemoveEntry ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label={copy.remove}
                          onClick={() => {
                            if (entries.length === 1) {
                              setOpen(false)
                            }
                            onRemoveEntry(index)
                          }}
                        >
                          <Trash2 />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{copy.remove}</TooltipContent>
                    </Tooltip>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ol>
      </PopoverContent>
    </Popover>
  )
}
