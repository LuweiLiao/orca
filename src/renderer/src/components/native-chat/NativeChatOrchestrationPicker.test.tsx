// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

const mocks = vi.hoisted(() => ({
  discover: vi.fn(),
  catalog: vi.fn(),
  detected: ['codex', 'claude', 'grok'],
  disabled: new Array<string>()
}))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, options?: Record<string, string | number>) =>
    fallback.replace(/{{(\w+)}}/g, (_, key: string) => String(options?.[key] ?? ''))
}))
vi.mock('@/store', () => ({
  useAppStore: (select: (state: { settings: { disabledTuiAgents: string[] } }) => unknown) =>
    select({ settings: { disabledTuiAgents: mocks.disabled } })
}))
vi.mock('@/hooks/useDetectedAgents', () => ({
  useDetectedAgents: () => ({ detectedIds: mocks.detected, isLoading: false })
}))
vi.mock('@/runtime/structured-agent-session-client', () => ({
  callStructuredAgentSession: (...args: unknown[]) => mocks.catalog(...args)
}))
vi.mock('@/lib/agent-catalog', () => ({
  getAgentCatalog: () => [
    { id: 'codex', label: 'Codex' },
    { id: 'claude', label: 'Claude' },
    { id: 'grok', label: 'Grok' }
  ],
  AgentIcon: () => null
}))
vi.mock('./native-chat-session-option-discovery', () => ({
  discoveryContextForTransport: (
    _target: unknown,
    _id: unknown,
    _connection: unknown,
    context: unknown
  ) => context,
  resolveNativeChatModelDiscoveryContext: () => ({
    hostKey: 'local',
    runtime: { target: { kind: 'local' }, prefs: {}, worktreeId: null, worktreePath: '' }
  }),
  discoverNativeChatCatalogModels: (...args: unknown[]) => mocks.discover(...args)
}))
vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    variant: _variant,
    size: _size,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) => (
    <button {...props}>{children}</button>
  )
}))
vi.mock('@/components/ui/input', () => ({
  Input: ({
    density: _density,
    ...props
  }: React.InputHTMLAttributes<HTMLInputElement> & { density?: string }) => <input {...props} />
}))
vi.mock('@/components/ui/checkbox', () => ({
  Checkbox: ({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: () => void }) => (
    <button type="button" role="checkbox" aria-checked={checked} onClick={onCheckedChange} />
  )
}))
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: () => null
}))
vi.mock('@/components/ui/popover', async () => {
  const { createContext, useContext } = await import('react')
  const Open = createContext<(open: boolean) => void>(() => {})
  return {
    Popover: ({
      children,
      onOpenChange
    }: {
      children: ReactNode
      onOpenChange: (open: boolean) => void
    }) => <Open.Provider value={onOpenChange}>{children}</Open.Provider>,
    PopoverTrigger: ({ children }: { children: ReactNode }) => {
      const setOpen = useContext(Open)
      return <span onClick={() => setOpen(true)}>{children}</span>
    },
    PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>
  }
})
vi.mock('@/components/ui/select', () => ({
  Select: ({
    children,
    value,
    onValueChange
  }: {
    children: ReactNode
    value: string
    onValueChange: (value: string) => void
  }) => (
    <select value={value} onChange={(event) => onValueChange(event.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  )
}))

import {
  NativeChatOrchestrationPicker,
  OrchestrationPickerContent
} from './NativeChatOrchestrationPicker'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.disabled = []
})

describe('NativeChatOrchestrationPicker', () => {
  it('offers the host-listed model after its first read reports listing in progress', async () => {
    mocks.catalog
      .mockResolvedValueOnce({ origin: 'unknown', listingInProgress: true })
      .mockResolvedValueOnce({
        origin: 'probe',
        models: [{ id: 'gpt-5.6', label: 'GPT-5.6' }]
      })
    const onInsert = vi.fn()
    render(
      <OrchestrationPickerContent
        host={{
          target: { kind: 'local' },
          detection: { kind: 'local' },
          preferHostCatalog: true
        }}
        onInsert={onInsert}
      />
    )

    fireEvent.click(screen.getAllByRole('checkbox')[0]!)
    await waitFor(() => expect(screen.getByRole('option', { name: 'GPT-5.6' })).toBeTruthy())
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'gpt-5.6' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add to message' }))
    expect(onInsert).toHaveBeenCalledWith([
      {
        agent: 'codex',
        label: 'Codex',
        task: '',
        count: 1,
        model: { id: 'gpt-5.6', label: 'GPT-5.6' }
      }
    ])
  })

  it('adds separate tasks, counts and models for the selected agents', async () => {
    mocks.discover.mockImplementation(async (agent: string) =>
      agent === 'codex' ? [{ id: 'gpt-5.6', label: 'GPT-5.6' }] : []
    )
    const onInsert = vi.fn()
    render(<NativeChatOrchestrationPicker terminalTabId="tab-1" onInsert={onInsert} />)

    fireEvent.click(screen.getByRole('button', { name: 'Orchestration agents' }))
    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[0]!)
    fireEvent.click(checkboxes[1]!)
    fireEvent.click(checkboxes[2]!)
    await waitFor(() => expect(screen.getByRole('option', { name: 'GPT-5.6' })).toBeTruthy())
    fireEvent.change(screen.getAllByRole('combobox')[0]!, { target: { value: 'gpt-5.6' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Codex Task (optional)' }), {
      target: { value: 'Fix' }
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Claude Task (optional)' }), {
      target: { value: 'Flash' }
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Grok Task (optional)' }), {
      target: { value: 'Compile' }
    })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Grok Agent count' }), {
      target: { value: '2' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add to message' }))

    expect(onInsert).toHaveBeenCalledWith([
      {
        agent: 'codex',
        label: 'Codex',
        task: 'Fix',
        count: 1,
        model: { id: 'gpt-5.6', label: 'GPT-5.6' }
      },
      { agent: 'claude', label: 'Claude', task: 'Flash', count: 1 },
      { agent: 'grok', label: 'Grok', task: 'Compile', count: 2 }
    ])
    expect(mocks.discover).toHaveBeenCalledWith(
      'codex',
      expect.objectContaining({ target: { kind: 'local' } }),
      'local'
    )
  })

  it('offers model-specific effort, clears an incompatible selection, and edits the task', async () => {
    mocks.catalog.mockResolvedValue({
      origin: 'probe',
      models: [
        {
          id: 'gpt-5.6-sol',
          label: 'GPT-5.6 Sol',
          efforts: [
            { value: 'high', label: 'High' },
            { value: 'max', label: 'Max' }
          ]
        },
        { id: 'small', label: 'Small', efforts: [{ value: 'low', label: 'Low' }] },
        { id: 'none', label: 'No reasoning', efforts: [] }
      ]
    })
    const onInsert = vi.fn()
    render(
      <OrchestrationPickerContent
        host={{ target: { kind: 'local' }, detection: { kind: 'local' }, preferHostCatalog: true }}
        initialSelections={[
          {
            agent: 'codex',
            label: 'Codex',
            task: 'Review',
            count: 1,
            model: { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
            effort: 'max'
          }
        ]}
        single
        onInsert={onInsert}
      />
    )
    await waitFor(() => expect(screen.getByRole('option', { name: 'Max' })).toBeTruthy())
    expect(screen.getAllByRole('combobox')[1]).toHaveProperty('value', 'max')
    fireEvent.change(screen.getByRole('textbox', { name: 'Codex Task (optional)' }), {
      target: { value: 'Review and test' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Update orchestration' }))
    expect(onInsert).toHaveBeenLastCalledWith([
      expect.objectContaining({ task: 'Review and test', effort: 'max' })
    ])
    fireEvent.change(screen.getAllByRole('combobox')[0]!, { target: { value: 'small' } })
    expect(screen.getAllByRole('combobox')[1]).toHaveProperty('value', '__default__')
    expect(screen.queryByRole('option', { name: 'Max' })).toBeNull()
    fireEvent.change(screen.getAllByRole('combobox')[1]!, { target: { value: 'low' } })
    fireEvent.click(screen.getByRole('button', { name: 'Update orchestration' }))
    expect(onInsert).toHaveBeenLastCalledWith([
      expect.objectContaining({
        effort: 'low',
        task: 'Review and test',
        model: { id: 'small', label: 'Small' }
      })
    ])
    fireEvent.change(screen.getAllByRole('combobox')[0]!, { target: { value: 'none' } })
    expect(screen.getAllByRole('combobox')[1]).toHaveProperty('value', '__default__')
    fireEvent.click(screen.getByRole('button', { name: 'Update orchestration' }))
    expect(onInsert.mock.lastCall?.[0][0].effort).toBeUndefined()
  })
})
