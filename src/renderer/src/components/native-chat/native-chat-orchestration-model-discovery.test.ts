import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PickerHost } from './native-chat-orchestration-model-discovery'

const mocks = vi.hoisted(() => ({
  catalog: vi.fn(),
  discover: vi.fn(),
  cached: vi.fn()
}))

vi.mock('@/runtime/structured-agent-session-client', () => ({
  callStructuredAgentSession: (...args: unknown[]) => mocks.catalog(...args)
}))
vi.mock('./native-chat-session-option-discovery', () => ({
  discoverNativeChatCatalogModels: (...args: unknown[]) => mocks.discover(...args)
}))
vi.mock('./native-chat-session-option-enrichment', () => ({
  readNativeChatEnrichedModels: (...args: unknown[]) => mocks.cached(...args)
}))

import { discoverOrchestrationModels } from './native-chat-orchestration-model-discovery'

const context = {
  hostKey: 'local',
  runtime: { target: { kind: 'local' } as const, worktreeId: 'wt', worktreePath: '/repo' }
}

afterEach(() => {
  vi.resetAllMocks()
})

describe('orchestration model discovery', () => {
  it('uses CCB discovery even when a host catalog is preferred', async () => {
    const host: PickerHost = {
      target: { kind: 'local' },
      detection: { kind: 'local' },
      discovery: context,
      preferHostCatalog: true
    }
    mocks.discover.mockResolvedValue([
      {
        id: 'gateway-model',
        label: 'Gateway model',
        options: [
          {
            id: 'effort',
            kind: { type: 'select', choices: [{ value: 'high', label: 'High' }] }
          }
        ]
      }
    ])
    expect(await discoverOrchestrationModels(host, 'ccb')).toEqual([
      {
        id: 'gateway-model',
        label: 'Gateway model',
        efforts: [{ value: 'high', label: 'High' }]
      }
    ])
    expect(mocks.catalog).not.toHaveBeenCalled()
    expect(mocks.discover).toHaveBeenCalledWith('ccb', context.runtime, 'local')
  })
  it('waits for a host catalog that is still listing before showing agent models', async () => {
    const host: PickerHost = {
      target: { kind: 'local' },
      detection: { kind: 'local', worktreeId: 'wt' },
      discovery: context,
      preferHostCatalog: true,
      worktreeId: 'wt'
    }
    mocks.catalog
      .mockResolvedValueOnce({ origin: 'unknown', listingInProgress: true })
      .mockResolvedValueOnce({
        origin: 'probe',
        models: [{ id: 'gpt-5.6', label: 'GPT-5.6' }]
      })

    expect(await discoverOrchestrationModels(host, 'codex')).toEqual([
      { id: 'gpt-5.6', label: 'GPT-5.6' }
    ])
    expect(mocks.catalog.mock.calls).toEqual([
      [{ kind: 'local' }, 'agentSession.modelCatalog', { agent: 'codex', worktree: 'id:wt' }],
      [
        { kind: 'local' },
        'agentSession.modelCatalog',
        { agent: 'codex', worktree: 'id:wt', waitForListing: true }
      ]
    ])
    expect(mocks.discover).not.toHaveBeenCalled()
  })

  it('uses the existing CLI discovery when an older host cannot list models', async () => {
    const host: PickerHost = {
      target: { kind: 'local' },
      detection: { kind: 'local' },
      discovery: context,
      preferHostCatalog: true
    }
    mocks.catalog.mockRejectedValue(new Error('method_not_found'))
    mocks.discover.mockResolvedValue([{ id: 'opus', label: 'Opus' }])

    expect(await discoverOrchestrationModels(host, 'claude')).toEqual([
      { id: 'opus', label: 'Opus' }
    ])
    expect(mocks.discover).toHaveBeenCalledWith('claude', context.runtime, 'local')
  })

  it('reads SSH models from the remote CLI instead of the local host catalog', async () => {
    const host: PickerHost = {
      target: { kind: 'local' },
      detection: { kind: 'ssh', connectionId: 'ssh-1' },
      discovery: context,
      preferHostCatalog: false
    }
    mocks.discover.mockResolvedValue([{ id: 'grok-4.7', label: 'Grok 4.7' }])

    expect(await discoverOrchestrationModels(host, 'grok')).toEqual([
      { id: 'grok-4.7', label: 'Grok 4.7' }
    ])
    expect(mocks.catalog).not.toHaveBeenCalled()
  })

  it('preserves host effort capabilities and does not invent unknown levels', async () => {
    const host: PickerHost = {
      target: { kind: 'environment', environmentId: 'remote' },
      detection: { kind: 'runtime', environmentId: 'remote' },
      preferHostCatalog: true
    }
    mocks.catalog.mockResolvedValue({
      origin: 'probe',
      models: [
        { id: 'sol', label: 'Sol', efforts: [{ value: 'high', label: 'High' }] },
        { id: 'none', label: 'None', efforts: [] },
        { id: 'unknown', label: 'Unknown', effortsKnown: false, efforts: [] }
      ]
    })
    expect(await discoverOrchestrationModels(host, 'codex')).toEqual([
      { id: 'sol', label: 'Sol', efforts: [{ value: 'high', label: 'High' }] },
      { id: 'none', label: 'None', efforts: [] },
      { id: 'unknown', label: 'Unknown' }
    ])
  })

  it('uses the remote CLI effort menu for SSH models', async () => {
    const host: PickerHost = {
      target: { kind: 'local' },
      detection: { kind: 'ssh', connectionId: 'ssh-1' },
      discovery: context,
      preferHostCatalog: false
    }
    mocks.discover.mockResolvedValue([
      {
        id: 'sol',
        label: 'Sol',
        options: [
          {
            id: 'effort',
            kind: {
              type: 'select',
              choices: [{ value: 'high', label: 'High' }],
              defaultValue: 'high'
            }
          }
        ]
      }
    ])
    expect(await discoverOrchestrationModels(host, 'codex')).toEqual([
      { id: 'sol', label: 'Sol', efforts: [{ value: 'high', label: 'High' }] }
    ])
  })
})
