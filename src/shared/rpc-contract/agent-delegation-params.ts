import { z } from 'zod'
import { OrchestrationAgentSelectionSchema } from '../native-chat-orchestration-reference'

const TerminalTarget = {
  ptyId: z.string().min(1).max(256).optional(),
  terminal: z.string().min(1).max(256).optional(),
  submissionId: z.string().min(1).max(128)
}

const oneTarget = (value: { ptyId?: string; terminal?: string }) =>
  Boolean(value.ptyId) !== Boolean(value.terminal)

/**
 * A person's terminal-agent composer submitting a message with assignment cards. The cards are the
 * composer's own pills, so they authorize the agent running in that terminal, named by its PTY on
 * this host or by the handle a paired client knows it by. They wait for the write's outcome.
 */
export const AgentDelegationAuthorizeTerminalParams = z
  .object({ ...TerminalTarget, cards: z.array(OrchestrationAgentSelectionSchema).min(1).max(16) })
  .strict()
  .refine(oneTarget, { message: 'Provide exactly one of ptyId/terminal' })

/** Whether that message reached the terminal: delivered cards authorize, others are withdrawn. */
export const AgentDelegationSettleTerminalParams = z
  .object({ ...TerminalTarget, delivered: z.boolean() })
  .strict()
  .refine(oneTarget, { message: 'Provide exactly one of ptyId/terminal' })
