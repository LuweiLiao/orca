// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { NativeChatMarkdown } from './NativeChatMarkdown'
import { nativeChatOrchestrationAttributes } from './native-chat-orchestration-instruction'

afterEach(cleanup)

it('renders sent and reloaded orchestration as bordered pills with task and effort', () => {
  const task = 'Check [parser](file.ts), `a_b` and <literal> 中文'
  const { token } = nativeChatOrchestrationAttributes({
    agent: 'codex',
    label: 'Codex',
    count: 1,
    task,
    effort: 'high',
    model: { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' }
  })
  const content = `Please ${token} then report.`
  const first = render(<NativeChatMarkdown content={content} variant="document" />)
  const pill = first.container.querySelector('[data-native-chat-orchestration="codex"]')
  expect(pill?.getAttribute('data-variant')).toBe('orchestrationPill')
  expect(pill?.textContent).toContain('effort: high')
  expect(pill?.textContent).toContain(task)
  expect(first.container.textContent).not.toContain('orca-orchestration:')
  expect(first.container.querySelector('a')).toBeNull()
  first.unmount()
  const restored = render(<NativeChatMarkdown content={content} variant="document" />)
  expect(
    restored.container.querySelector('[data-native-chat-orchestration]')?.textContent
  ).toContain(task)
})

it('does not turn code examples or legacy plain prose into orchestration pills', () => {
  const { token } = nativeChatOrchestrationAttributes({
    agent: 'codex',
    label: 'Codex',
    count: 1,
    task: ''
  })
  const { container } = render(
    <NativeChatMarkdown
      content={`1 Codex agent(s) (Default model)\n\n\`\`\`text\n${token}\n\`\`\``}
      variant="document"
    />
  )
  expect(container.querySelector('[data-native-chat-orchestration]')).toBeNull()
})
