import type { AgentSessionLaunchPlan } from './agent-session-launch-plan'
import type { AgentLaunchRequestId } from './agent-launch-request-id'

/** The user action this launch serves: minted where that action is handled, or carried by the
 *  route the caller already planned for it. */
export type LaunchAgentInNewTabRequest =
  | { requestId: AgentLaunchRequestId; agentSessionLaunchPlan?: undefined }
  | {
      /** Keeps a preflighted route authoritative across workspace creation. */
      agentSessionLaunchPlan: AgentSessionLaunchPlan
      requestId?: undefined
    }
