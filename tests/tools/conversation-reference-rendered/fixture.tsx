import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { NativeChatPromptEditor } from '@/components/native-chat/NativeChatPromptEditor'
import { useConversationReferenceDrop } from '@/components/native-chat/use-conversation-reference-drop'
import type { NativeChatComposerInput } from '../../../src/renderer/src/components/native-chat/native-chat-composer-input'
import { writeConversationReferenceDrag } from '@/lib/conversation-reference-drag'
import { writeAiVaultSessionDragData, hasAiVaultSessionDragData } from '@/lib/ai-vault-session-drag'
import { forwardConversationReferenceDrop } from '@/lib/conversation-reference-drop-target'
import {
  conversationReferenceUri,
  withConversationReferenceInstructions,
  type ConversationReferenceCreate
} from '../../../src/shared/conversation-reference'
import { TooltipProvider } from '@/components/ui/tooltip'
import './fixture.css'

const api = {
  aiVault: {
    createConversationReference: async (request: ConversationReferenceCreate) => ({
      uri: conversationReferenceUri('12345678-1234-4234-8234-123456789abc'),
      title: request.title,
      agent: 'claude'
    }),
    readConversationReference: async () => ({
      messages: [
        {
          role: 'assistant',
          text: 'The earlier conversation contains this source answer.',
          messageIndex: 0,
          textOffset: 0
        }
      ],
      nextCursor: null,
      warnings: []
    })
  }
}
Object.defineProperty(window, 'api', { value: api, configurable: true })

function Fixture() {
  const input = useRef<NativeChatComposerInput | null>(null)
  const [text, setText] = useState('')
  const [sent, setSent] = useState('')
  const [historyDrag, setHistoryDrag] = useState(false)
  const [resumed, setResumed] = useState(0)
  useEffect(() => {
    const capture = (event: DragEvent): void => {
      if (
        event.dataTransfer &&
        hasAiVaultSessionDragData(event.dataTransfer) &&
        forwardConversationReferenceDrop(event)
      ) {
        setHistoryDrag(false)
      }
    }
    window.addEventListener('drop', capture, true)
    return () => window.removeEventListener('drop', capture, true)
  }, [])
  const drop = useConversationReferenceDrop('rendered-reference', input, false, () => false)
  return (
    <TooltipProvider>
      <main className="flex min-h-screen bg-background text-foreground">
        <aside className="w-64 shrink-0 border-r border-border p-4">
          <div
            draggable
            data-testid="history"
            onDragStart={(event) => {
              setHistoryDrag(true)
              writeAiVaultSessionDragData(event.dataTransfer, {
                agent: 'cursor',
                sessionId: 'history-source',
                title: 'Cursor history conversation',
                command: 'cursor-agent --resume history-source',
                sessionExecutionHostId: 'local'
              })
            }}
            onDragEnd={() => setHistoryDrag(false)}
          >
            Cursor history conversation
          </div>
          <div
            draggable
            onDragStart={(event) =>
              writeConversationReferenceDrag(event.dataTransfer, {
                source: { kind: 'transcript', agent: 'claude', sessionId: 'source' },
                title: 'Claude Code conversation',
                executionHostId: 'local'
              })
            }
            className="cursor-grab rounded-md p-2 hover:bg-accent"
            data-testid="source"
          >
            Claude Code conversation
          </div>
        </aside>
        <section className="flex min-w-0 flex-1 flex-col justify-end gap-3 p-6 native-chat-appearance">
          <div
            data-conversation-reference-drop
            data-testid="composer"
            onDragOver={drop.onDragOver}
            onDrop={drop.onDrop}
            className="rounded-xl border border-chat-composer-border bg-chat-composer-surface p-3"
          >
            <NativeChatPromptEditor
              inputRef={input}
              initialValue=""
              placeholder="Message"
              disabled={false}
              className="min-h-20 text-sm text-chat-foreground-strong outline-none"
              onChange={(field) => setText(field.value)}
              onSelect={() => {}}
            />
            <button
              type="button"
              disabled={drop.pending}
              onClick={() => setSent(withConversationReferenceInstructions(text))}
            >
              Send
            </button>
          </div>
          <output data-testid="sent" className="max-h-24 overflow-auto whitespace-pre-wrap text-xs">
            {sent}
          </output>
        </section>
        {historyDrag ? (
          <div
            data-testid="resume-overlay"
            className="fixed inset-0 z-50"
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => setResumed((count) => count + 1)}
          />
        ) : null}
        <output data-testid="resumed">{resumed}</output>
      </main>
    </TooltipProvider>
  )
}

createRoot(document.getElementById('root')!).render(<Fixture />)
