// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { NativeChatConversationSidebar } from './NativeChatConversationSidebar'
import { nativeChatCapabilityUsage } from './native-chat-capability-usage'
import type { NativeChatMessage } from '../../../../shared/native-chat-types'

afterEach(cleanup)
const messages: NativeChatMessage[] = [
  {
    id: 'tool-row',
    role: 'assistant',
    timestamp: 0,
    source: 'transcript',
    blocks: [
      { type: 'tool-call', name: 'Skill', input: { skill: 'review' }, callId: 'skill-1' },
      { type: 'tool-call', name: 'mcp__zotero__search', input: {}, callId: 'mcp-1' },
      { type: 'tool-call', name: 'mcp__zotero__search', input: {}, callId: 'mcp-1' },
      { type: 'tool-call', name: 'Read', input: { file_path: 'SKILL.md' } }
    ]
  }
]

function draw() {
  const onChange = vi.fn(async () => true)
  const onUseSkill = vi.fn()
  const onSelect = vi.fn()
  const onReveal = vi.fn()
  render(
    <TooltipProvider>
      <NativeChatConversationSidebar
        messages={messages}
        items={[{ id: 'old-user', slotIndex: null, text: 'Earlier question', hasImages: false }]}
        activeId="old-user"
        pendingId={null}
        onSelect={onSelect}
        onReveal={onReveal}
        controls={{
          capabilities: {
            selection: { disabledSkills: [], disabledMcpServers: [] },
            skills: [{ kind: 'skill', name: 'review', path: '/skills/review/SKILL.md' }],
            mcpServers: [
              { name: 'zotero', status: 'connected' },
              { name: 'cua_repl', status: 'connected', locked: 'plugin' }
            ]
          },
          onChange,
          onUseSkill,
          canUseSkill: true
        }}
      />
    </TooltipProvider>
  )
  return { onChange, onUseSkill, onSelect, onReveal }
}

describe('conversation capability sidebar', () => {
  it('keeps server identity and counts each provider call once', () => {
    const usage = nativeChatCapabilityUsage(messages)
    expect(usage.skills.get('review')).toEqual({ count: 1, messageId: 'tool-row' })
    expect(usage.mcpServers.get('zotero')).toEqual({ count: 1, messageId: 'tool-row' })
    expect(usage.skills.size).toBe(1)
  })

  it('disables every switchable entry in one mutation and restores the defaults', async () => {
    const { onChange } = draw()
    const menu = () => screen.getByRole('button', { name: 'More actions' })
    fireEvent.pointerDown(menu(), { button: 0 })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Disable all' }))
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({
        disabledSkills: ['review'],
        disabledMcpServers: ['zotero']
      })
    )
    fireEvent.pointerDown(menu(), { button: 0 })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Enable all' }))
    expect(onChange).toHaveBeenLastCalledWith({ disabledSkills: [], disabledMcpServers: [] })
    expect(screen.queryByRole('switch', { name: 'MCP: cua_repl' })).toBeNull()
  })

  it('inserts a skill through the composer callback and reveals recorded usage', () => {
    const { onUseSkill, onReveal } = draw()
    fireEvent.click(screen.getByRole('button', { name: 'Use this turn' }))
    expect(onUseSkill).toHaveBeenCalledWith('review', '/skills/review/SKILL.md')
    fireEvent.click(screen.getByRole('button', { name: 'zotero: Used 1' }))
    expect(onReveal).toHaveBeenCalledWith('tool-row')
  })

  it('passes an unloaded timeline entry to the existing history jump', () => {
    const { onSelect } = draw()
    fireEvent.click(screen.getByRole('button', { name: /Earlier question/ }))
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'old-user', slotIndex: null })
    )
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'zotero' } })
    expect(screen.queryByRole('button', { name: 'Use this turn' })).toBeNull()
    expect(screen.getByRole('switch', { name: 'MCP: zotero' })).toBeTruthy()
  })
})
