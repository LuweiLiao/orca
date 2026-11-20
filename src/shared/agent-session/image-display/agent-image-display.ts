export type AgentImageDisplayState = 'pending' | 'loaded' | 'failed'

export type AgentImageDisplay = { id: string; state: AgentImageDisplayState }

export type AgentImageDisplayReceipt = AgentImageDisplay & {
  sessionId: string
  path: string
  itemId: string
}

export const AGENT_IMAGE_DISPLAY_CAPABILITY = 'agent-session.image-display.v1' as const
