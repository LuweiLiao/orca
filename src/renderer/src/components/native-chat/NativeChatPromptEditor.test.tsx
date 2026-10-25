import { readNativeChatDraftDocument } from './native-chat-draft-cache'
// @vitest-environment happy-dom
import { createRef, type ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NativeChatPromptEditor } from './NativeChatPromptEditor'
import {
  insertNativeChatPastedText,
  type NativeChatComposerInput
} from './native-chat-composer-input'
import { promptEditor } from './native-chat-prompt-editor.test-support'

afterEach(cleanup)

function renderEditor(node: ReactNode) {
  return render(<TooltipProvider>{node}</TooltipProvider>)
}

function setup(value = '') {
  const inputRef = createRef<NativeChatComposerInput>()
  const onChange = vi.fn()
  const view = renderEditor(
    <NativeChatPromptEditor
      inputRef={inputRef}
      initialValue={value}
      disabled={false}
      placeholder="Message"
      onChange={onChange}
      onSelect={vi.fn()}
    />
  )
  return {
    ...view,
    input: inputRef.current!,
    editor: promptEditor(within(view.container).getByRole('textbox')),
    onChange
  }
}

describe('native chat skill editor', () => {
  it('inserts orchestration as editable document atoms and restores them from the draft', async () => {
    const scopeKey = 'orchestration-pane'
    const inputRef = createRef<NativeChatComposerInput>()
    const props = {
      inputRef,
      scopeKey,
      initialValue: 'Before after',
      disabled: false,
      placeholder: 'Message',
      onChange: vi.fn(),
      onSelect: vi.fn()
    }
    const first = renderEditor(<NativeChatPromptEditor {...props} />)
    act(() => inputRef.current!.setSelectionRange(7, 7))
    act(() =>
      inputRef.current!.insertOrchestration?.([
        { agent: 'claude', label: 'Claude', task: 'Flash', count: 1 },
        { agent: 'grok', label: 'Grok', task: 'Compile', count: 2 }
      ])
    )
    const text = inputRef.current!.value
    expect(text).toContain('Flash: 1 Claude agent(s)')
    expect(text).toContain('Compile: 2 Grok agent(s)')
    await waitFor(() =>
      expect(first.container.querySelectorAll('[data-native-chat-orchestration]')).toHaveLength(2)
    )
    const chips = first.container.querySelectorAll('[data-native-chat-orchestration]')
    expect(chips[0]?.textContent).toBe('1 Claude agent(s) (Default model)')
    expect(chips[1]?.textContent).toBe('2 Grok agent(s) (Default model)')
    expect(chips[0]?.textContent).not.toContain('Flash')
    const editor = promptEditor(within(first.container).getByRole('textbox'))
    act(() => {
      inputRef.current!.setSelectionRange(7, 12)
      editor.view.dispatch(editor.state.tr.insertText('Burn'))
    })
    expect(inputRef.current!.value).toContain('Burn: 1 Claude agent(s)')
    expect(first.container.querySelectorAll('[data-native-chat-orchestration]')).toHaveLength(2)
    expect(text.startsWith('Before ')).toBe(true)
    expect(text.endsWith('after')).toBe(true)
    first.unmount()
    const revised = text.replace('Flash', 'Burn')
    const second = renderEditor(<NativeChatPromptEditor {...props} initialValue={revised} />)
    await waitFor(() =>
      expect(second.container.querySelectorAll('[data-native-chat-orchestration]')).toHaveLength(2)
    )
    expect(inputRef.current!.value).toBe(revised)
  })

  it('removes one chosen orchestration model from the draft with its close button', async () => {
    const { input, container } = setup('Compare ')
    act(() => input.setSelectionRange(8, 8))
    act(() =>
      input.insertOrchestration?.([
        {
          agent: 'claude',
          label: 'Claude',
          task: '',
          count: 1,
          model: { id: 'opus', label: 'Opus' }
        }
      ])
    )
    expect(input.value).toContain('model: opus')
    await waitFor(() =>
      expect(container.querySelector('[data-native-chat-orchestration]')).not.toBeNull()
    )

    fireEvent.click(screen.getByRole('button', { name: 'Remove agent selection' }))

    expect(input.value).toBe('Compare ')
    expect(container.querySelector('[data-native-chat-orchestration]')).toBeNull()
  })

  it('renders only picker insertions as pills and serializes the exact invocation', async () => {
    const { input, container } = setup('Please $rev')
    await act(async () => input.insertSkill!(7, 11, '$review'))
    const pill = container.querySelector('[data-native-chat-skill]')
    expect(pill?.textContent).toBe('Review')
    expect(pill?.classList.contains('text-xs')).toBe(true)
    expect(pill?.classList.contains('text-sm')).toBe(false)
    expect(input.value).toBe('Please $review ')
    expect(input.selectionStart).toBe(15)
    act(() => {
      input.value += '$review typed manually'
    })
    expect(container.querySelectorAll('[data-native-chat-skill]')).toHaveLength(1)
    expect(input.value).toBe('Please $review $review typed manually')
  })

  it("labels Pi's `/skill:<name>` pill by the skill alone", async () => {
    const { input, container } = setup('/cav')
    await act(async () => input.insertSkill!(0, 4, '/skill:caveman'))
    expect(container.querySelector('[data-native-chat-skill]')?.textContent).toBe('Caveman')
    expect(input.value).toBe('/skill:caveman ')
  })

  it('shows attached files as filename pills that serialize to the reference the agent reads', async () => {
    const { input, container, onChange } = setup('See  please')
    act(() => input.setSelectionRange(4, 4))
    await act(async () =>
      input.insertFileReferences!(['/Users/abc/Downloads/test (1).csv', 'C:\\docs\\letter.pdf'])
    )
    const pills = [...container.querySelectorAll('[data-native-chat-file-reference]')]
    expect(pills.map((pill) => pill.textContent)).toEqual(['test (1).csv', 'letter.pdf'])
    expect(pills[0].getAttribute('title')).toBe('/Users/abc/Downloads/test (1).csv')
    const references = '@"/Users/abc/Downloads/test (1).csv" @C:\\docs\\letter.pdf '
    expect(input.value).toBe(`See ${references} please`)
    expect(input.selectionStart).toBe(4 + references.length)
    expect(onChange).toHaveBeenCalled()
    const edited = input.value.replace('letter.pdf', 'letter.pd')
    act(() => {
      input.value = edited
    })
    expect(container.querySelectorAll('[data-native-chat-file-reference]')).toHaveLength(1)
    expect(input.value).toBe(edited)
  })

  it('keeps typed and restored invocations plain', () => {
    const { container, input } = setup('$review /review')
    expect(container.querySelector('[data-native-chat-skill]')).toBeNull()
    act(() => {
      input.value = '$review restored'
    })
    expect(container.querySelector('[data-native-chat-skill]')).toBeNull()
  })

  it('deletes a skill atomically and restores it with undo', async () => {
    const { input, editor, container } = setup('$rev')
    act(() => input.insertSkill!(0, 4, '$review'))
    act(() => {
      input.setSelectionRange(0, 7)
      editor.commands.deleteSelection()
    })
    expect(input.value).toBe(' ')
    expect(container.querySelector('[data-native-chat-skill]')).toBeNull()
    await act(async () => {
      editor.commands.undo()
    })
    expect(input.value).toBe('$review ')
    expect(container.querySelector('[data-native-chat-skill]')).not.toBeNull()
  })

  it('reads the current text and caret after edits and undo, separately per editor', async () => {
    const first = setup('one')
    const second = setup('second')
    act(() => first.input.setSelectionRange(3, 3))
    act(() => first.input.insertText!('!'))
    expect(first.input.value).toBe('one!')
    expect(first.input.selectionStart).toBe(4)
    expect(second.input.value).toBe('second')
    await act(async () => {
      first.editor.commands.undo()
    })
    expect(first.input.value).toBe('one')
    expect(first.input.selectionStart).toBe(3)
    expect(second.input.value).toBe('second')
  })

  it('preserves multiple selected skills through multiline edits and clears them on send', async () => {
    const { input, container } = setup('$one')
    act(() => input.insertSkill!(0, 4, '$one'))
    act(() => {
      input.value += '\nthen $two'
    })
    await act(async () => input.insertSkill!(11, 15, '$two'))
    expect(input.value).toBe('$one \nthen $two ')
    expect(container.querySelectorAll('[data-native-chat-skill]')).toHaveLength(2)
    act(() => {
      input.value = ''
    })
    expect(input.value).toBe('')
    expect(container.querySelector('[data-native-chat-skill]')).toBeNull()
  })

  it('restores selected nodes only in their owning pane draft', async () => {
    const inputRef = createRef<NativeChatComposerInput>()
    const props = {
      inputRef,
      scopeKey: 'pill-pane',
      initialValue: '$rev',
      disabled: false,
      placeholder: 'Message',
      onChange: vi.fn(),
      onSelect: vi.fn()
    }
    const first = renderEditor(<NativeChatPromptEditor {...props} />)
    act(() => inputRef.current!.insertSkill!(0, 4, '$review'))
    expect(
      readNativeChatDraftDocument('pill-pane', '$review ')?.content?.[0]?.content?.[0]?.type
    ).toBe('nativeChatSkill')
    first.unmount()
    const second = renderEditor(<NativeChatPromptEditor {...props} initialValue="$review " />)
    await waitFor(() =>
      expect(second.container.querySelector('[data-native-chat-skill]')).not.toBeNull()
    )
    second.unmount()
    const other = renderEditor(
      <NativeChatPromptEditor {...props} scopeKey="other-pane" initialValue="$review " />
    )
    expect(other.container.querySelector('[data-native-chat-skill]')).toBeNull()
  })

  it.each(['$revision ', '$preview '])(
    'replaces partial skill text with %s without a stale pill',
    (replacement) => {
      const { input, container } = setup('$rev')
      act(() => input.insertSkill!(0, 4, '$review'))
      act(() => {
        input.value = replacement
      })
      expect(input.value).toBe(replacement)
      expect(container.querySelector('[data-native-chat-skill]')).toBeNull()
    }
  )

  it('pastes rich clipboard content as literal text without manufacturing pills', () => {
    const { input, container } = setup()
    fireEvent.paste(screen.getByRole('textbox'), {
      clipboardData: {
        getData: (format: string) =>
          format === 'text/plain'
            ? '$review\nhello'
            : '<span data-native-chat-skill="$review">review</span>'
      }
    })
    expect(input.value).toBe('$review\nhello')
    expect(container.querySelector('[data-native-chat-skill]')).toBeNull()
  })
})

it('replaces the selection with literal pasted text as one undoable edit', async () => {
  const { input, editor } = setup('hello world')
  act(() => input.setSelectionRange(6, 11))
  await act(async () => input.insertText?.('안녕\n$literal'))
  expect(input.value).toBe('hello 안녕\n$literal')
  await act(async () => {
    editor.commands.undo()
  })
  expect(input.value).toBe('hello world')
})

it('moves focus into the composer when a paste is routed from elsewhere', async () => {
  const { input, editor } = setup('hi')
  act(() => input.setSelectionRange(2, 2))
  const hiddenTerminal = document.createElement('textarea')
  document.body.append(hiddenTerminal)
  hiddenTerminal.focus()
  await act(async () => {
    insertNativeChatPastedText(input, ' there')
  })
  expect(input.value).toBe('hi there')
  expect(editor.view.dom.contains(document.activeElement)).toBe(true)
  hiddenTerminal.remove()
})
