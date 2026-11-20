import { describe, expect, it } from 'vitest'
import { claudeStructuredSpawnOptions } from './claude-structured-spawn-options'
import { claudeChatSelectionRequiresRestart } from './claude-chat-capabilities'
import {
  CLAUDE_STRUCTURED_BASE_OPTIONS,
  type ClaudeStructuredSdkOptions
} from './claude-structured-launch-resolution'

function launched(
  saved: Record<string, string>,
  base: ClaudeStructuredSdkOptions = CLAUDE_STRUCTURED_BASE_OPTIONS
) {
  return claudeStructuredSpawnOptions({
    launch: { options: base, resumesTranscript: false },
    saved,
    effortFlag: 'supported',
    flagSettingsControl: 'supported'
  })
}

describe("a Claude chat's Skill and MCP selection", () => {
  it('applies only to this launch and leaves the shared defaults alone', () => {
    const chatCapabilities = JSON.stringify({
      disabledSkills: ['review'],
      disabledMcpServers: ['zotero']
    })
    const base = { ...CLAUDE_STRUCTURED_BASE_OPTIONS, settings: { fastMode: false } }
    const spawn = launched({ chatCapabilities }, base)
    expect(spawn.sdkOptions.settings).toEqual({
      fastMode: false,
      skillOverrides: { review: 'off' },
      deniedMcpServers: [{ serverName: 'zotero' }]
    })
    expect(base.settings).toEqual({ fastMode: false })
  })

  it('refuses a launch whose --settings file it cannot merge into', () => {
    const chatCapabilities = JSON.stringify({ disabledSkills: [], disabledMcpServers: ['zotero'] })
    expect(() =>
      launched(
        { chatCapabilities },
        { ...CLAUDE_STRUCTURED_BASE_OPTIONS, extraArgs: { settings: '/custom/settings.json' } }
      )
    ).toThrow('explicit --settings')
  })

  it('restarts the child only when the selection itself changed', () => {
    const selection = { disabledSkills: ['review', 'writing'], disabledMcpServers: ['zotero'] }
    const session = { options: new Map([['chatCapabilities', JSON.stringify(selection)]]) }
    const reordered = JSON.stringify({ ...selection, disabledSkills: ['writing', 'review'] })
    expect(claudeChatSelectionRequiresRestart(session, { chatCapabilities: reordered })).toBe(false)
    expect(claudeChatSelectionRequiresRestart(session, undefined)).toBe(true)
    expect(claudeChatSelectionRequiresRestart(undefined, undefined)).toBe(false)
  })
})
