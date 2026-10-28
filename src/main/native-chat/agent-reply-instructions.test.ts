import { describe, expect, it } from 'vitest'
import { agentReplyInstructions } from './agent-reply-instructions'

describe('agentReplyInstructions', () => {
  it('gives Claude and Codex the Doubao persona last, only while it is on', () => {
    for (const agent of ['claude', 'codex']) {
      const on = agentReplyInstructions(agent, {
        experimentalDoubaoPersona: true,
        experimentalClaudeChineseReplies: true,
        experimentalCodexConciseReplies: true
      })!
      expect(on.trimEnd().split('\n\n').at(-1)).toMatch(/^## 豆包人设/)
      expect(on).toContain('我会以更直白、更直接的方式')
      expect(agentReplyInstructions(agent, {})).not.toContain('豆包')
    }
    expect(agentReplyInstructions('gemini', { experimentalDoubaoPersona: true })).toBeNull()
  })
})
