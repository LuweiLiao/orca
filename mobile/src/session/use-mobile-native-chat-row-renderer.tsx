import { useCallback, useMemo } from 'react'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { NativeChatTurnJournal } from '../../../src/shared/native-chat-turn-membership'
import type { NativeChatTaskListPredecessors } from '../../../src/shared/native-chat-task-list-history'
import type { NativeChatResolvedPrompt } from '../../../src/shared/native-chat-resolution-receipt'
import { isActionableStructuredAgentSessionPrompt } from '../../../src/shared/structured-agent-session-live-turn'
import { MobileNativeChatMessage } from './MobileNativeChatMessage'
import { mobileNativeChatUnsentNotices } from './mobile-native-chat-unsent-notices'
import type { useMobileNativeChatTurnDisclosure } from './use-mobile-native-chat-turn-disclosure'
import {
  MobileNativeChatHandoffDivider,
  mobileNativeChatHandoff,
  mobileNativeChatHandoffInstruction
} from './MobileNativeChatHandoff'

/** Desktop parity: `NativeChatTranscriptRow`'s context. */
export function useMobileNativeChatRowRenderer({
  rowKeyOf,
  runOwners,
  taskListPredecessors,
  fontScale,
  onOpenFile,
  structuredActivityUi,
  turns,
  turnJournal,
  agent,
  receipts,
  actionablePromptIds
}: {
  /** The row's place on the page, kept while older messages join it. */
  rowKeyOf: (message: NativeChatMessage) => string
  runOwners: ReadonlyMap<string, string>
  /** The last plan each task-list tool wrote before each row, by row id. */
  taskListPredecessors: ReadonlyMap<string, NativeChatTaskListPredecessors>
  fontScale: number
  onOpenFile?: (relativePath: string) => void
  structuredActivityUi: boolean
  turns: ReturnType<typeof useMobileNativeChatTurnDisclosure>
  turnJournal: NativeChatTurnJournal | null
  agent: string | null | undefined
  receipts: ReadonlyMap<string, NativeChatResolvedPrompt> | null
  actionablePromptIds: readonly string[] | undefined
}): ({ item, index }: { item: NativeChatMessage; index: number }) => React.JSX.Element {
  const unsentNotices = useMemo(
    () => mobileNativeChatUnsentNotices(turnJournal, agent),
    [turnJournal, agent]
  )
  return useCallback(
    ({ item, index }) => {
      const handoff = mobileNativeChatHandoff(item)
      const own = handoff ? mobileNativeChatHandoffInstruction(item, handoff) : item
      const row = (message: NativeChatMessage) => (
        <MobileNativeChatMessage
          message={message}
          rowKey={rowKeyOf(item)}
          // The calls, not the record: a rebuilt record would defeat the row's memo.
          previousTodoWrite={taskListPredecessors.get(item.id)?.todowrite}
          previousUpdatePlan={taskListPredecessors.get(item.id)?.update_plan}
          fontScale={fontScale}
          onOpenFile={onOpenFile}
          structuredActivityUi={structuredActivityUi}
          onToggleTurn={turns.onToggleTurn}
          unsentNotice={item.unsent ? unsentNotices.get(item.id) : undefined}
          receipt={receipts?.get(item.id)}
          awaiting={isActionableStructuredAgentSessionPrompt(item.id, actionablePromptIds)}
          {...turns.resolveRow(index, item)}
          runOwner={runOwners.get(item.id)}
        />
      )
      if (!handoff) {
        return row(item)
      }
      // A hand-off with no instruction is the divider alone; with one, the bubble follows it.
      const divider = <MobileNativeChatHandoffDivider handoff={handoff} fontScale={fontScale} />
      return own ? (
        <>
          {divider}
          {row(own)}
        </>
      ) : (
        divider
      )
    },
    [
      rowKeyOf,
      runOwners,
      taskListPredecessors,
      fontScale,
      onOpenFile,
      structuredActivityUi,
      turns,
      unsentNotices,
      receipts,
      actionablePromptIds
    ]
  )
}
