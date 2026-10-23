import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { ChevronDown, ChevronUp, MessageSquarePlus, Pencil, TextSearch, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  useNativeChatAnnotationLocate,
  type NativeChatAnnotationNavigation
} from './use-native-chat-annotation-locate'
import type { NativeChatComposerHandle } from './native-chat-composer-types'
import { nativeChatAnnotationCopy } from './native-chat-annotation-copy'
import { formatNativeChatAnnotations } from './native-chat-annotations-store'
import type { NativeChatAnnotationAnchor } from './native-chat-annotation-anchor'
import {
  useNativeChatAnnotations,
  useNativeChatAnnotationHighlights
} from './use-native-chat-annotations'

export function useNativeChatAnnotationReview({
  scopeKey,
  rootRef,
  composerRef,
  enabled,
  messageListRef
}: {
  scopeKey?: string
  rootRef: RefObject<HTMLElement | null>
  composerRef: RefObject<NativeChatComposerHandle | null>
  enabled: boolean
  messageListRef?: RefObject<NativeChatAnnotationNavigation | null>
}) {
  const review = useNativeChatAnnotations(scopeKey)
  const highlightName = useNativeChatAnnotationHighlights(rootRef, review.notes, enabled)
  const editor = review.editor
  const setEditor = review.setEditor
  const [expanded, setExpanded] = useState(true)
  const [transferErrorScope, setTransferErrorScope] = useState<string>()
  const { locate, missingOriginal, resetMissingOriginal } = useNativeChatAnnotationLocate(
    rootRef,
    scopeKey,
    enabled,
    messageListRef
  )
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const copy = nativeChatAnnotationCopy()
  const editorIdentity = editor ? JSON.stringify([scopeKey, editor.id, editor.anchor]) : null
  useEffect(() => {
    if (editorIdentity && expanded) {
      inputRef.current?.focus()
    }
  }, [editorIdentity, expanded])

  const save = (): void => {
    if (!editor?.comment.trim()) {
      return
    }
    if (editor.id) {
      if (!review.update(editor.id, editor.comment)) {
        review.add(editor.anchor, editor.comment)
      }
    } else {
      review.add(editor.anchor, editor.comment)
    }
    setEditor(undefined)
  }
  const begin = (anchor: NativeChatAnnotationAnchor): void => {
    if (!scopeKey) {
      return
    }
    save()
    setEditor({ anchor, comment: '' })
    setExpanded(true)
    resetMissingOriginal()
  }
  const transfer = (): void => {
    const composer = composerRef.current
    if (!composer?.acceptsText()) {
      return
    }
    const notes = review.notes.filter((note) => note.id !== editor?.id)
    const entries = editor?.comment.trim()
      ? [...notes, { ...editor.anchor, comment: editor.comment }]
      : notes
    if (entries.length === 0) {
      return
    }
    if (!composer.appendTextDurably?.(`${copy.title}\n\n${formatNativeChatAnnotations(entries)}`)) {
      setTransferErrorScope(scopeKey)
      return
    }
    setTransferErrorScope(undefined)
    review.consume(review.notes, editor)
    composer.focus()
  }
  const count =
    review.notes.length + (editor && !review.notes.some((note) => note.id === editor.id) ? 1 : 0)
  const iconButton = (label: string, icon: ReactNode, action: () => void) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon-xs" aria-label={label} onClick={action}>
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )

  return {
    begin: scopeKey ? begin : undefined,
    tray:
      scopeKey && count > 0 ? (
        <section
          data-native-chat-annotations=""
          aria-label={copy.title}
          className="mx-auto w-full max-w-(--chat-content-max-width) shrink-0 px-4 py-1 text-sm text-chat-foreground"
        >
          <style>{`::highlight(${highlightName}) { background-color: color-mix(in srgb, var(--markdown-search-match) 55%, transparent); color: inherit; }`}</style>
          <div className="flex min-h-8 items-center gap-2 border-b border-border">
            <MessageSquarePlus className="size-3.5" />
            <span className="min-w-0 flex-1 truncate text-xs">
              {copy.title} ({count})
            </span>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              onClick={transfer}
              disabled={editor ? !editor.comment.trim() : review.notes.length === 0}
            >
              {copy.addToMessage}
            </Button>
            {iconButton(
              expanded ? copy.collapse : copy.expand,
              expanded ? <ChevronDown /> : <ChevronUp />,
              () => setExpanded(!expanded)
            )}
          </div>
          {review.persistenceError ? (
            <p role="status" className="py-1 text-xs text-chat-warning">
              {copy.notSaved}
            </p>
          ) : null}
          {transferErrorScope === scopeKey ? (
            <p role="status" className="py-1 text-xs text-chat-warning">
              {copy.transferFailed}
            </p>
          ) : null}
          {missingOriginal ? (
            <p role="status" className="py-1 text-xs text-chat-foreground-faint">
              {copy.originalUnavailable}
            </p>
          ) : null}
          {expanded ? (
            <div className="scrollbar-sleek max-h-64 overflow-y-auto overscroll-contain">
              {editor ? (
                <form
                  className="space-y-2 border-b border-border py-2"
                  onSubmit={(event) => {
                    event.preventDefault()
                    save()
                  }}
                >
                  <blockquote className="scrollbar-sleek max-h-20 overflow-y-auto whitespace-pre-wrap break-words border-l-2 border-border pl-2 text-xs text-chat-foreground-faint">
                    {editor.anchor.quote}
                  </blockquote>
                  <Textarea
                    ref={inputRef}
                    aria-label={copy.comment}
                    value={editor.comment}
                    rows={3}
                    className="max-h-40 min-h-16 resize-y"
                    onChange={(event) => setEditor({ ...editor, comment: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.nativeEvent.isComposing) {
                        return
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        event.stopPropagation()
                        setEditor(undefined)
                      }
                      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                        event.preventDefault()
                        event.stopPropagation()
                        save()
                      }
                    }}
                  />
                  <div className="flex justify-end gap-1">
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      onClick={() => setEditor(undefined)}
                    >
                      {copy.cancel}
                    </Button>
                    <Button type="submit" size="xs" disabled={!editor.comment.trim()}>
                      {copy.save}
                    </Button>
                  </div>
                </form>
              ) : null}
              <ol className="divide-y divide-border">
                {review.notes
                  .filter((note) => note.id !== editor?.id)
                  .map((note, index) => (
                    <li key={note.id} className="py-2">
                      <div className="flex items-start gap-2">
                        <span className="pt-1 text-xs text-chat-foreground-faint">
                          {index + 1}.
                        </span>
                        <blockquote className="min-w-0 flex-1 whitespace-pre-wrap break-words border-l-2 border-border pl-2 text-xs text-chat-foreground-faint">
                          {note.quote}
                        </blockquote>
                        <div className="flex shrink-0">
                          {iconButton(copy.locate, <TextSearch />, () => locate(note))}
                          {iconButton(copy.edit, <Pencil />, () => {
                            save()
                            if (scopeKey) {
                              setEditor({
                                anchor: note,
                                id: note.id,
                                comment: note.comment
                              })
                            }
                          })}
                          {iconButton(copy.remove, <Trash2 />, () => review.remove(note.id))}
                        </div>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap break-words pl-5 text-sm">
                        {note.comment}
                      </p>
                    </li>
                  ))}
              </ol>
            </div>
          ) : null}
        </section>
      ) : null
  }
}
