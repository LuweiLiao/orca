import type { AgentJournalItemBody } from './agent-session-journal-types'
import type { AgentSessionQueuedMessage } from './agent-session-wire'
import { pendingPromptsAllUnanswerableHere } from './agent-session-approval-subject'

export function commandCardWaiting(
  messages: readonly AgentSessionQueuedMessage[] | null | undefined
): boolean {
  return (messages ?? []).some(
    (message) =>
      message.state === 'waiting' && !message.paused && message.body.command !== undefined
  )
}

export function structuredAgentSessionQueueEnabled(
  queueFollowUps: boolean,
  session: { queuedMessages?: readonly AgentSessionQueuedMessage[] | null },
  prompts: readonly { body: AgentJournalItemBody }[]
): boolean {
  return (
    (queueFollowUps || commandCardWaiting(session.queuedMessages)) &&
    !pendingPromptsAllUnanswerableHere(prompts)
  )
}

export function structuredAgentSessionFollowUpsQueue(
  followUpsQueue: boolean,
  send: { alternate?: boolean; isWorking: boolean; stopping: boolean }
): boolean {
  return send.alternate && send.isWorking && !send.stopping ? !followUpsQueue : followUpsQueue
}
