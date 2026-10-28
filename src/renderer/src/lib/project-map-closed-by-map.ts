// Chats the person closed from the project map. A closed chat with no fork or reference has
// nothing left to draw it, so this desktop remembers it as a grey node to reopen. Never sent.

import type { ExecutionHostId } from '../../../shared/execution-host'
import { createLocalBoundedListStore } from './local-bounded-list-store'

const MAX_CLOSED = 50

export type ProjectMapClosedChat = {
  sessionId: string
  workspaceId: string
  executionHostId: ExecutionHostId | null
  agent: string
  title: string | null
  closedAt: number
}

function isClosedChat(value: unknown): value is ProjectMapClosedChat {
  return (
    typeof value === 'object' &&
    value !== null &&
    'sessionId' in value &&
    typeof value.sessionId === 'string' &&
    'workspaceId' in value &&
    typeof value.workspaceId === 'string' &&
    'executionHostId' in value &&
    (value.executionHostId === null || typeof value.executionHostId === 'string') &&
    'agent' in value &&
    typeof value.agent === 'string' &&
    'title' in value &&
    (value.title === null || typeof value.title === 'string') &&
    'closedAt' in value &&
    typeof value.closedAt === 'number'
  )
}

const store = createLocalBoundedListStore('orca.project-map-closed.v1', MAX_CLOSED, isClosedChat)

export const projectMapClosedChats = store.read
export const subscribeToProjectMapClosedChats = store.subscribe

export function noteProjectMapClosedChat(chat: Omit<ProjectMapClosedChat, 'closedAt'>): void {
  store.write([
    ...store.read().filter((entry) => entry.sessionId !== chat.sessionId),
    { ...chat, closedAt: Date.now() }
  ])
}

export function forgetProjectMapClosedChat(sessionId: string): void {
  const kept = store.read().filter((entry) => entry.sessionId !== sessionId)
  if (kept.length !== store.read().length) {
    store.write(kept)
  }
}
