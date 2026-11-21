// @vitest-environment happy-dom
import { createRef } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { NativeChatRailItem } from '../viewport/rail/native-chat-message-rail-items'
import { NativeChatConversationViewport } from './NativeChatConversationViewport'

afterEach(cleanup)

const items: NativeChatRailItem[] = [
  { id: 'first', slotIndex: 0, text: 'First question', hasImages: false },
  { id: 'second', slotIndex: 1, text: 'Second question', hasImages: false }
]

function draw() {
  const onSelect = vi.fn()
  render(
    <TooltipProvider>
      <NativeChatConversationViewport
        frame={{
          shown: true,
          controls: {
            capabilities: {
              selection: { disabledSkills: [], disabledMcpServers: [] },
              skills: [],
              mcpServers: []
            },
            onChange: async () => true,
            onUseSkill: () => {},
            canUseSkill: true
          },
          messages: [],
          rail: {
            ticks: items,
            items,
            activeId: 'second',
            onActivate: () => {},
            visible: true,
            previewId: null,
            focusId: null,
            onFocusItem: () => {},
            previewReply: '',
            onPreview: () => {}
          },
          pendingId: null,
          onSelect,
          onReveal: () => {}
        }}
        viewport={{
          scrollRef: createRef<HTMLDivElement>(),
          scrollerProps: {},
          forwardedGesture: () => {},
          showJump: false,
          onJump: () => {}
        }}
        railRef={createRef<HTMLDivElement>()}
        onRailWheel={() => {}}
        newRowsMarked={false}
        olderHistory={null}
      >
        <p>Transcript</p>
      </NativeChatConversationViewport>
    </TooltipProvider>
  )
  return { onSelect }
}

const sidebarName = 'Skills, MCP and timeline'

describe('conversation viewport sidebar', () => {
  it('starts closed with the message rail jumping and the docks keeping their width', () => {
    const { onSelect } = draw()
    expect(screen.queryByRole('complementary', { name: sidebarName })).toBeNull()
    expect(document.querySelector('[data-native-chat-sidebar-open="true"]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'First question' }))
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'first' }))
  })

  it('opens from the rail-side toggle and closes back to the rail', () => {
    draw()
    fireEvent.click(screen.getByRole('button', { name: sidebarName, expanded: false }))
    expect(screen.getByRole('complementary', { name: sidebarName })).toBeTruthy()
    expect(document.querySelector('[data-native-chat-sidebar-open="true"]')).toBeTruthy()
    expect(screen.queryByRole('toolbar', { name: 'Your messages' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: sidebarName, expanded: true }))
    expect(screen.queryByRole('complementary', { name: sidebarName })).toBeNull()
    expect(screen.getByRole('toolbar', { name: 'Your messages' })).toBeTruthy()
  })
})
