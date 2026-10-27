import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { NativeChatConversationReference } from './NativeChatConversationReference'
import { conversationReferenceToken } from '../../../../shared/conversation-reference'

export function NativeChatConversationReferencePill({
  node,
  selected,
  deleteNode,
  editor,
  updateAttributes
}: NodeViewProps): React.JSX.Element {
  return (
    <NodeViewWrapper as="span" className="inline" contentEditable={false}>
      <NativeChatConversationReference
        uri={String(node.attrs.uri)}
        title={String(node.attrs.title)}
        selected={selected}
        onRemove={editor.isEditable ? deleteNode : undefined}
        onReplace={
          editor.isEditable
            ? (reference) =>
                updateAttributes({
                  uri: reference.uri,
                  title: reference.title,
                  token: conversationReferenceToken(reference)
                })
            : undefined
        }
      />
    </NodeViewWrapper>
  )
}
