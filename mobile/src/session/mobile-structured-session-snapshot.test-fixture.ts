import type { AgentSessionSubscribeEvent } from '../../../src/shared/agent-session-wire'
export function snapshotEvent(fence = 3): AgentSessionSubscribeEvent {
  return {
    type: 'snapshot',
    sessionId: 'session-1',
    fence,
    page: {
      sessionId: 'session-1',
      epoch: 'epoch-1',
      fence,
      direction: 'tail',
      items: [],
      removedItemIds: [],
      submissions: [],
      window: {
        oldest: null,
        newest: null,
        nextCursor: { epoch: 'epoch-1', sequence: 0 }
      },
      liveCursor: { epoch: 'epoch-1', sequence: 0 },
      hasOlder: false,
      hasNewer: false
    }
  }
}

export function snapshotWithMessage(): AgentSessionSubscribeEvent {
  const event = snapshotEvent()
  return {
    ...event,
    page: {
      ...event.page,
      items: [
        {
          itemId: 'msg-1',
          revision: 1,
          sequence: 1,
          observedAt: 10,
          body: {
            kind: 'message',
            role: 'user',
            blocks: [{ type: 'text', text: 'sent before the blip' }]
          }
        }
      ],
      window: {
        oldest: { epoch: 'epoch-1', sequence: 1 },
        newest: { epoch: 'epoch-1', sequence: 1 },
        nextCursor: { epoch: 'epoch-1', sequence: 2 }
      },
      liveCursor: { epoch: 'epoch-1', sequence: 1 }
    }
  } as AgentSessionSubscribeEvent
}
