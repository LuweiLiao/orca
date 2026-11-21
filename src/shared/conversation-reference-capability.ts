// Kept apart from conversation-reference so capability lists don't pull its schemas into phone route chunks.
export const CONVERSATION_REFERENCE_CAPABILITY = 'conversation.references.v1' as const
// Why: create params are strict, so an older host refuses a `range` outright; send one only here.
export const CONVERSATION_REFERENCE_RANGE_CAPABILITY = 'conversation.references.range.v1' as const
