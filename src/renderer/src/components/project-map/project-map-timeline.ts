import type { AgentSessionConversationOutline } from '../../../../shared/agent-session-conversation-outline'
import {
  agentSessionLineageSources,
  type AgentSessionLineageEntry
} from '../../../../shared/agent-session-fork'
import type { AgentSessionReferenceLink } from '../../../../shared/agent-session-reference-link'
import { conversationReferenceSnapshotCount } from '../../../../shared/conversation-reference'

/** A chat on the map a timeline marker can lead to. */
export type ProjectMapTimelineNode = { paneKey: string | null; title: string }

export type ProjectMapTimelineFork = {
  childSessionId: string
  node: ProjectMapTimelineNode
  /** Messages the child was handed. */
  messageCount: number
}

export type ProjectMapTimelineReference = {
  /** The recorded reference: its message and its URI. */
  id: string
  sessionId: string | null
  node: ProjectMapTimelineNode
  /** How many of the other chat's messages a snapshot reads; null when it follows that chat live. */
  snapshotCount: number | null
}

export type ProjectMapTimelineTurn = {
  itemId: string
  sequence: number
  preview: string
  reply: string | null
  imageCount: number
  /** Children cut after this turn, before the next one opened. */
  forks: ProjectMapTimelineFork[]
  /** Other chats this turn's message pointed the agent at. */
  referencesSent: ProjectMapTimelineReference[]
}

export type ProjectMapTimeline = {
  turns: ProjectMapTimelineTurn[]
  /** Oldest turns the host left out to fit one reply. */
  omittedTurns: number
  /** Children cut from history a rewind has since discarded. */
  rewoundForks: ProjectMapTimelineFork[]
  /** References whose message is outside the listed turns. */
  unplacedReferencesSent: ProjectMapTimelineReference[]
  /** Chats whose messages pointed their agent at this one. */
  referencedBy: ProjectMapTimelineReference[]
}

type Relations = {
  sessionId: string
  outline: AgentSessionConversationOutline
  lineage: Iterable<AgentSessionLineageEntry>
  references: readonly AgentSessionReferenceLink[]
  nodeOf: (sessionId: string) => ProjectMapTimelineNode
}

/**
 * One chat's turns with what branched off each: the forks cut after it and the references its
 * message sent, plus who references the chat. Turns are the outline's user messages, in order.
 */
export function projectMapTimeline({
  sessionId,
  outline,
  lineage,
  references,
  nodeOf
}: Relations): ProjectMapTimeline {
  const turns: ProjectMapTimelineTurn[] = [...outline.entries]
    .sort((a, b) => a.sequence - b.sequence)
    .map((entry) => ({
      itemId: entry.itemId,
      sequence: entry.sequence,
      preview: entry.preview,
      reply: entry.reply ?? null,
      imageCount: entry.imageCount,
      forks: [],
      referencesSent: []
    }))
  const rewoundForks: ProjectMapTimelineFork[] = []
  for (const entry of lineage) {
    // A merge counts for every chat it was handed, each at its own cut.
    const cut = agentSessionLineageSources(entry).find(
      (source) => source.sessionId === sessionId
    )?.cut
    if (!cut) {
      continue
    }
    const fork = {
      childSessionId: entry.childSessionId,
      node: nodeOf(entry.childSessionId),
      messageCount: cut.messageCount
    }
    const turn =
      cut.journalEpoch === outline.cursor.epoch ? turnAt(turns, cut.journalSequence) : undefined
    if (turn) {
      turn.forks.push(fork)
    } else {
      rewoundForks.push(fork)
    }
  }
  const unplacedReferencesSent: ProjectMapTimelineReference[] = []
  const referencedBy: ProjectMapTimelineReference[] = []
  for (const link of references) {
    if (link.targetSessionId === sessionId) {
      const reference = {
        id: `${link.messageId}:${link.referenceUri}`,
        sessionId: link.source?.sessionId ?? null,
        node: link.source ? nodeOf(link.source.sessionId) : { paneKey: null, title: link.title },
        snapshotCount:
          link.sourceMessageCount ?? conversationReferenceSnapshotCount(link.referenceUri)
      }
      const turn = turns.find((candidate) => candidate.itemId === link.messageId)
      if (turn) {
        turn.referencesSent.push(reference)
      } else {
        unplacedReferencesSent.push(reference)
      }
    } else if (link.source?.sessionId === sessionId) {
      referencedBy.push({
        id: `${link.messageId}:${link.referenceUri}`,
        sessionId: link.targetSessionId,
        node: nodeOf(link.targetSessionId),
        snapshotCount:
          link.sourceMessageCount ?? conversationReferenceSnapshotCount(link.referenceUri)
      })
    }
  }
  return {
    turns,
    omittedTurns: outline.omittedEntries,
    rewoundForks,
    unplacedReferencesSent,
    referencedBy
  }
}

/** The turn a journal position falls in: the last one opened at or before it. */
function turnAt(
  turns: readonly ProjectMapTimelineTurn[],
  sequence: number
): ProjectMapTimelineTurn | undefined {
  let found: ProjectMapTimelineTurn | undefined
  for (const turn of turns) {
    if (turn.sequence > sequence) {
      break
    }
    found = turn
  }
  return found
}

/**
 * Children a rewind to the message at `sequence` would cut away from: they were handed part of
 * what it discards. Their own copy stays; the point they were cut from no longer exists here.
 */
export function projectMapForksPastRewind(
  lineage: Iterable<AgentSessionLineageEntry>,
  rewind: { sessionId: string; epoch: string; sequence: number }
): AgentSessionLineageEntry[] {
  return [...lineage].filter((entry) =>
    agentSessionLineageSources(entry).some(
      (source) =>
        source.sessionId === rewind.sessionId &&
        source.cut.journalEpoch === rewind.epoch &&
        source.cut.journalSequence >= rewind.sequence
    )
  )
}
