import { GLOBAL_FLAGS, type CommandSpec } from '../args'

export const IMAGE_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['image', 'show'],
    summary: 'Display an image inside the current Orca conversation',
    usage: 'orca image show <path> [--title <text>] [--session <id>] [--id <request-id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'path', 'title', 'session', 'id'],
    positionalArgs: ['path'],
    notes: [
      'Defaults to ORCA_AGENT_SESSION_ID, the current structured chat. Outside a chat, supply --session.',
      'The image stays inside the conversation; this command never opens or focuses a window.',
      'A pending receipt means the image was published. Use image status to observe loaded or failed; loaded means an Orca viewer decoded the image, not that a person looked at it.',
      'Reuse --id after an uncertain response to avoid a duplicate. A remote invocation reads the path on the selected execution host.',
      "Paired remote calls require --session; this client's ORCA_AGENT_SESSION_ID cannot identify a conversation on another host."
    ]
  },
  {
    path: ['image', 'status'],
    summary: 'Read whether an Orca viewer loaded a published image',
    usage: 'orca image status <id> [--session <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id', 'session'],
    positionalArgs: ['id']
  }
]
