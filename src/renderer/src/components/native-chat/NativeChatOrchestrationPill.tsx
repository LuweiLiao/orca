import { useContext, useRef, useState } from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { ListTree } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { translate } from '@/i18n/i18n'
import { NativeChatOrchestrationContext } from './native-chat-orchestration-context'
import {
  nativeChatOrchestrationAttributes,
  nativeChatOrchestrationSelection
} from './native-chat-orchestration-instruction'
import { OrchestrationPickerContent, pickerHost } from './NativeChatOrchestrationPicker'

export function NativeChatOrchestrationPill({
  node,
  selected,
  updateAttributes,
  editor
}: NodeViewProps): React.JSX.Element {
  const context = useContext(NativeChatOrchestrationContext)
  const [open, setOpen] = useState(false)
  const updatedRef = useRef(false)
  const selection = nativeChatOrchestrationSelection(node.attrs)
  const label = String(node.attrs.token)
  return (
    <NodeViewWrapper as="span" className="inline" contentEditable={false}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Badge variant="orchestrationPill" asChild data-selected={selected}>
            <button
              type="button"
              aria-label={translate(
                'components.native-chat.composer.editOrchestration',
                'Edit orchestration: {{label}}',
                { label }
              )}
              data-native-chat-orchestration={selection?.agent ?? ''}
              className="cursor-pointer"
            >
              <ListTree aria-hidden="true" />
              <span className="truncate">{label}</span>
            </button>
          </Badge>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          collisionPadding={8}
          className="w-84 max-w-(--radix-popover-content-available-width)"
          onCloseAutoFocus={(event) => {
            if (updatedRef.current) {
              event.preventDefault()
              updatedRef.current = false
              editor.commands.focus()
            }
          }}
        >
          {open && selection && context ? (
            <OrchestrationPickerContent
              host={pickerHost(context.terminalTabId, context.structuredTransport)}
              initialSelections={[selection]}
              single
              onInsert={(selections) => {
                const updated = selections[0]
                if (updated) {
                  updateAttributes(nativeChatOrchestrationAttributes(updated))
                  updatedRef.current = true
                  setOpen(false)
                }
              }}
            />
          ) : null}
        </PopoverContent>
      </Popover>
    </NodeViewWrapper>
  )
}
