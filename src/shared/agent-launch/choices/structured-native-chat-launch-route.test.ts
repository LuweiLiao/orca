import { describe, expect, it } from 'vitest'
import { STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY } from '../../agent-session/capabilities/agent-session-runtime-capabilities'
import { CLAUDE_LAUNCHER_RUNTIME_CAPABILITY } from '../catalog/claude-cli-launch-agents'
import {
  resolveStructuredNativeChatSupport,
  type StructuredNativeChatSupportInput
} from './structured-native-chat-launch-route'

function support(overrides: Partial<StructuredNativeChatSupportInput> = {}) {
  return resolveStructuredNativeChatSupport({
    agent: 'claude',
    executionHostId: 'local',
    hostCapabilities: [STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY],
    workspaceKind: 'git-worktree',
    ...overrides
  })
}

describe('a Claude launcher', () => {
  it('opens a chat only on a host that starts launchers', () => {
    expect(
      support({
        agent: 'ccb',
        hostCapabilities: [
          STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY,
          CLAUDE_LAUNCHER_RUNTIME_CAPABILITY
        ]
      })
    ).toEqual({ supported: true })
    expect(support({ agent: 'ccb' })).toEqual({ supported: false, blocker: 'runtime-capability' })
  })
})
