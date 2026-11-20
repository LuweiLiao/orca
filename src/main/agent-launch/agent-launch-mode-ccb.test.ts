import { expect, it } from 'vitest'
import { decideAgentLaunchMode } from './agent-launch-mode'

it.each([
  ['chat', true, 'structured'],
  ['chat', false, 'terminal'],
  ['terminal', true, 'terminal']
] as const)(
  'routes ccb with default %s and launcher chat support %s to %s',
  (surface, launcherChats, expected) => {
    const result = decideAgentLaunchMode({
      placement: { agent: 'ccb' },
      settings: { agentDefaultSurface: surface },
      launcherChats
    })
    expect(result.mode).toBe(expected)
  }
)
