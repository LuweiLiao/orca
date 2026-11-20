import { describe, expect, it } from 'vitest'
import {
  orchestrationReferenceToken,
  parseOrchestrationReferenceUri,
  splitOrchestrationReferences
} from './native-chat-orchestration-reference'

describe('orchestration references', () => {
  const selection = {
    agent: 'codex',
    label: 'Codex',
    count: 1,
    effort: 'high',
    model: { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
    task: 'Review [core](file.ts), `a_b`, C:\\code and 中文\nthen test ("quoted")'
  }

  it('round trips multiple assignments with literal task punctuation and surrounding text', () => {
    const token = orchestrationReferenceToken(selection, `Codex: ${selection.task}`)
    expect(splitOrchestrationReferences(`Before ${token}; ${token} after`)).toEqual([
      'Before ',
      selection,
      '; ',
      selection,
      ' after'
    ])
    expect(token).not.toContain('\n')
  })

  it.each([
    'javascript:alert(1)',
    'orca-orchestration://assignment/v2?data=%7B%7D',
    'orca-orchestration://assignment/v1?data=broken',
    `orca-orchestration://assignment/v1?data=${encodeURIComponent(JSON.stringify({ ...selection, count: 0 }))}`,
    `orca-orchestration://assignment/v1?data=${encodeURIComponent(JSON.stringify(selection))}#bad`
  ])('keeps invalid references as ordinary text: %s', (uri) => {
    expect(parseOrchestrationReferenceUri(uri)).toBeNull()
    const text = `[label](${uri})`
    expect(splitOrchestrationReferences(text)).toEqual([text])
  })
})
