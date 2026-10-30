import { z } from 'zod'
import { PROJECT_FLOW_HISTORY_MAX_PAGE } from '../project-flow-history'

/** Rows after `cursor` (or from the start), within the time range, oldest first. */
export const ProjectFlowHistoryParams = z
  .object({
    /** Epoch ms; rows at or after it. */
    since: z.number().finite().optional(),
    /** Epoch ms; rows before it. */
    until: z.number().finite().optional(),
    limit: z.number().int().min(1).max(PROJECT_FLOW_HISTORY_MAX_PAGE).optional(),
    cursor: z.string().min(1).max(64).optional()
  })
  .strict()
