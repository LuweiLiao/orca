import { expect, it } from 'vitest'
import type { TuiAgent } from '../../../shared/tui-agent'
import { buildNewTabAgentMenuRows } from './new-tab-agent-menu-rows'
import { withClaudeLauncherChats } from '../../../shared/claude-cli-launch-agents'
const disabledTuiAgents: TuiAgent[] = ['pi']
const fromDetection = (detected: readonly TuiAgent[]) => (agent: TuiAgent) =>
  detected.includes(agent) ? ('available' as const) : ('missing' as const)
const input = {
  settings: { experimentalNativeChat: true, disabledTuiAgents },
  detectedOnHost: ['claude', 'gemini'] as const,
  chatAgents: ['claude', 'codex', 'pi'] as const,
  hostChatAnswer: () => 'yes' as const,
  chatProgram: fromDetection(['claude', 'gemini'])
}
it('orders enabled chats, unavailable providers and CLI rows', () => {
  expect(buildNewTabAgentMenuRows(input)).toEqual([
    { kind: 'chat', agent: 'claude' },
    { kind: 'chat-unavailable', agent: 'codex', reason: 'not-installed' },
    { kind: 'cli', agent: 'gemini' }
  ])
})
it('offers an installed ccb as a chat beside Claude rather than as a CLI', () => {
  const detected: TuiAgent[] = ['claude', 'ccb']
  expect(
    buildNewTabAgentMenuRows({
      ...input,
      detectedOnHost: detected,
      chatAgents: withClaudeLauncherChats(['claude']),
      chatProgram: fromDetection(detected)
    })
  ).toEqual([
    { kind: 'chat', agent: 'claude' },
    { kind: 'chat', agent: 'ccb' }
  ])
})
it.each([true, false])('uses workspace installation for unchosen agents: %s', (installed) => {
  expect(
    buildNewTabAgentMenuRows({
      ...input,
      detectedOnHost: installed ? ['opencode'] : [],
      chatAgents: ['opencode'],
      chatProgram: fromDetection(installed ? ['opencode'] : [])
    })
  ).toEqual(installed ? [{ kind: 'chat', agent: 'opencode' }] : [])
})
