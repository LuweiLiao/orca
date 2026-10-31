import { describe, expect, it } from 'vitest'
import { buildAgentSessionHandoffPrompt } from './agent-session-fork-context'
import { buildAgentSessionMergeHandoffPrompt } from './agent-session-merge-handoff'
import {
  buildAgentSessionSummaryHandoffPrompt,
  parseAgentSessionHandoffMessage
} from './agent-session-handoff-text'

describe('hand-off first message', () => {
  it('reads back a summary hand-off: its sources, summary and the person’s instruction', () => {
    const text = buildAgentSessionSummaryHandoffPrompt({
      summary: 'Goal: fold the hand-off.\n```ts\nconst x = 1\n```',
      sources: [{ label: 'Map work', agentLabel: 'claude', reference: 'orca://ref/1' }],
      instruction: 'Now wire the divider.'
    })
    expect(text).toContain('orca://ref/1')
    expect(parseAgentSessionHandoffMessage(text)).toEqual({
      kind: 'summary',
      merged: false,
      sourceLabels: ['Map work'],
      context: 'Goal: fold the hand-off.\n```ts\nconst x = 1\n```',
      handedOver: null,
      instruction: 'Now wire the divider.'
    })
    const merged = buildAgentSessionSummaryHandoffPrompt({
      summary: 'Both chats agree.',
      sources: [{ label: 'A' }, { label: 'B' }]
    })
    expect(parseAgentSessionHandoffMessage(merged)).toMatchObject({
      kind: 'summary',
      merged: true,
      sourceLabels: ['A', 'B'],
      instruction: null
    })
  })

  it('folds hand-offs made before summaries, and leaves other messages alone', () => {
    const transcript = buildAgentSessionHandoffPrompt({
      messages: [
        { role: 'user', text: 'Sketch the lanes' },
        { role: 'assistant', text: 'Done.' }
      ],
      sourceLabel: 'Lanes',
      agentLabel: 'claude',
      instruction: 'Continue.'
    })!.text
    expect(parseAgentSessionHandoffMessage(transcript)).toMatchObject({
      kind: 'messages',
      merged: false,
      sourceLabels: ['Lanes'],
      handedOver: { count: 2, total: 2 },
      instruction: 'Continue.'
    })
    const merge = buildAgentSessionMergeHandoffPrompt({
      sources: [
        { messages: [{ role: 'user', text: 'one' }], sourceLabel: 'A' },
        { messages: [{ role: 'user', text: 'two' }], sourceLabel: 'B' }
      ]
    })!.text
    expect(parseAgentSessionHandoffMessage(merge)).toMatchObject({
      kind: 'messages',
      merged: true,
      sourceLabels: ['A', 'B'],
      instruction: null
    })
    expect(parseAgentSessionHandoffMessage('Please fix the build.')).toBeNull()
    // Quoting the opening alone, without the hand-off's body, is an ordinary message.
    expect(
      parseAgentSessionHandoffMessage(
        'This conversation continues from another Orca conversation. Why does it say that?'
      )
    ).toBeNull()
  })
})
