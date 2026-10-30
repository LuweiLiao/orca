// A compacted hand-off: one summary of every source through its cut stands in for their messages.

import type { RpcContext } from '../core'
import { buildAgentSessionSummaryHandoffPrompt } from '../../../../shared/agent-session-handoff-text'
import {
  forkSourceReference,
  type resolveForkSource
} from './structured-agent-session-fork-sources'

type ForkSection = Awaited<ReturnType<typeof resolveForkSource>>

/**
 * The first message of a summarized hand-off: one summary of every source through its cut, with a
 * reference to each source's full messages. Runs in a local workspace, where the summary model runs.
 */
export async function summaryHandoffText(
  ctx: RpcContext,
  cwd: string | null,
  sections: readonly ForkSection[],
  instruction: string | undefined
): Promise<{ text: string; handedOver: number[] }> {
  if (!cwd) {
    throw new Error(
      'Summarized hand-offs need a workspace on this computer; hand over the full history instead.'
    )
  }
  const summary = await ctx.runtime.conversationSummaryForHandoff(
    {
      cwd,
      sections: sections.map((section) => ({
        label: section.record.conversationName ?? null,
        messages: section.taken.messages.map(({ role, text }) => ({ role, text }))
      }))
    },
    ctx.signal
  )
  if (!summary.success) {
    throw new Error(
      summary.canceled
        ? 'The hand-off was canceled while its summary was written.'
        : `Could not summarize the chat for the hand-off: ${summary.error}`
    )
  }
  const references = await Promise.all(
    sections.map((section) =>
      forkSourceReference(section.record, section.taken.cut).catch(() => null)
    )
  )
  return {
    text: buildAgentSessionSummaryHandoffPrompt({
      summary: summary.text,
      sources: sections.map((section, index) => ({
        label: section.record.conversationName ?? null,
        agentLabel: section.record.provider,
        reference: references[index]
      })),
      instruction: instruction ?? null
    }),
    handedOver: sections.map((section) => section.taken.cut.messageCount)
  }
}
