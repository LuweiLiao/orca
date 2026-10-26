// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { NativeChatMarkdown } from './NativeChatMarkdown'
import { nativeChatOrchestrationAttributes } from './native-chat-orchestration-instruction'
import {
  NativeChatOrchestrationProposalActions,
  NativeChatOrchestrationProposalProvider
} from './NativeChatOrchestrationProposal'
import { splitOrchestrationReferences } from '../../../../shared/native-chat-orchestration-reference'

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

it('inserts a proposed assignment into this conversation only after the user clicks', () => {
  const { token } = nativeChatOrchestrationAttributes({
    agent: 'claude',
    label: 'Claude',
    count: 1,
    model: { id: 'opus', label: 'Opus' },
    effort: 'high',
    task: 'Review the authorization boundary'
  })
  const composer = { acceptsText: vi.fn(() => true), appendText: vi.fn() }
  const view = (proposal = true, streaming = false, available = true) => (
    <TooltipProvider>
      <NativeChatOrchestrationProposalProvider
        composerRef={{ current: composer }}
        available={available}
      >
        <NativeChatMarkdown
          content={token}
          variant="document"
          orchestrationProposals={proposal}
          streaming={streaming}
        />
      </NativeChatOrchestrationProposalProvider>
    </TooltipProvider>
  )
  const rendered = render(view())
  expect(composer.appendText).not.toHaveBeenCalled()
  fireEvent.click(rendered.getByRole('button', { name: 'Add to message' }))
  expect(composer.appendText).toHaveBeenCalledOnce()
  expect(splitOrchestrationReferences(composer.appendText.mock.calls[0]![0])).toEqual(
    splitOrchestrationReferences(token)
  )

  composer.acceptsText.mockReturnValue(false)
  fireEvent.click(rendered.getByRole('button', { name: 'Add to message' }))
  expect(composer.appendText).toHaveBeenCalledTimes(1)

  rendered.rerender(view(false))
  expect(rendered.queryByRole('button', { name: 'Add to message' })).toBeNull()
  rendered.rerender(view(true, true))
  expect(rendered.queryByRole('button', { name: 'Add to message' })).toBeNull()
  rendered.rerender(view(true, false, false))
  expect(rendered.queryByRole('button', { name: 'Add to message' })).toBeNull()
})

it('adds every card a reply proposes with one click, as one message', () => {
  const card = (effort: string) =>
    nativeChatOrchestrationAttributes({
      agent: 'claude',
      label: 'Claude',
      count: 1,
      model: { id: 'opus', label: 'Opus' },
      effort,
      task: `Review with ${effort} effort`
    }).token
  // A card shown twice or only quoted back is not another agent to confirm.
  const markdown = `${card('high')}\n\n${card('low')}\n\n${card('high')}\n\n> ${card('medium')}`
  const composer = {
    acceptsText: vi.fn(() => true),
    appendText: vi.fn(),
    appendTextAndSend: vi.fn()
  }
  const view = (target: typeof composer | Omit<typeof composer, 'appendTextAndSend'>) => (
    <TooltipProvider>
      <NativeChatOrchestrationProposalProvider composerRef={{ current: target }} available>
        <NativeChatOrchestrationProposalActions markdown={markdown} />
      </NativeChatOrchestrationProposalProvider>
    </TooltipProvider>
  )
  const rendered = render(view(composer))
  fireEvent.click(rendered.getByRole('button', { name: 'Add all 2 and send' }))
  expect(composer.appendTextAndSend).toHaveBeenCalledOnce()
  expect(splitOrchestrationReferences(composer.appendTextAndSend.mock.calls[0]![0])).toEqual(
    splitOrchestrationReferences(`${card('high')}; ${card('low')}`)
  )
  expect(composer.appendText).not.toHaveBeenCalled()

  const { appendTextAndSend: _, ...withoutSend } = composer
  rendered.rerender(view(withoutSend))
  fireEvent.click(rendered.getByRole('button', { name: 'Add all 2 and send' }))
  expect(composer.appendText).toHaveBeenCalledOnce()
  expect(composer.appendTextAndSend).toHaveBeenCalledOnce()
})
