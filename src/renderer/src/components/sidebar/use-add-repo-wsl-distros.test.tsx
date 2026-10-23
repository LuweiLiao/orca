// @vitest-environment happy-dom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WslHostAddResult, WslHostDistro } from '../../../../shared/wsl-host-types'
import { useAddRepoWslDistros } from './use-add-repo-wsl-distros'

const mocks = vi.hoisted(() => ({
  settings: { experimentalWslHosts: false },
  updateSettingsOrThrow: vi.fn(),
  setRuntimeEnvironments: vi.fn(),
  readRuntimeHostStatusSnapshots: vi.fn(),
  serverFilesMissing: false
}))

vi.mock('@/store', () => ({
  useAppStore: { getState: () => mocks }
}))

vi.mock('./use-wsl-hosts-enabled', () => ({
  wslHostsAvailable: () => true,
  useWslHostServerFilesMissing: () => mocks.serverFilesMissing
}))

const ubuntu: WslHostDistro = { name: 'Ubuntu', version: 2, state: 'stopped', environmentId: null }
const listDistros = vi.fn<() => Promise<WslHostDistro[]>>()
const add = vi.fn<() => Promise<WslHostAddResult>>()
const connect = vi.fn<() => Promise<void>>()
const listEnvironments = vi.fn()

beforeEach(() => {
  vi.resetAllMocks()
  mocks.settings = { experimentalWslHosts: false }
  mocks.serverFilesMissing = false
  mocks.updateSettingsOrThrow.mockResolvedValue(undefined)
  mocks.readRuntimeHostStatusSnapshots.mockResolvedValue(undefined)
  listDistros.mockResolvedValue([ubuntu])
  listEnvironments.mockResolvedValue([])
  add.mockResolvedValue({ ok: true, environmentId: 'wsl:ubuntu' })
  connect.mockResolvedValue(undefined)
  Object.assign(window, {
    api: {
      runtimeEnvironments: {
        wslHosts: { listDistros, add, connect },
        list: listEnvironments
      }
    }
  })
})

afterEach(cleanup)

describe('WSL distros in Add Project', () => {
  it('discovers stopped distros without starting them, then connects the chosen distro', async () => {
    const onConnected = vi.fn()
    const { result, rerender } = renderHook(
      ({ open }) => useAddRepoWslDistros({ open, onConnected }),
      { initialProps: { open: false } }
    )
    expect(listDistros).not.toHaveBeenCalled()
    rerender({ open: true })
    await waitFor(() => expect(result.current.distros).toEqual([ubuntu]))
    expect(add).not.toHaveBeenCalled()
    expect(connect).not.toHaveBeenCalled()
    expect(mocks.updateSettingsOrThrow).not.toHaveBeenCalled()

    await act(() => result.current.connect('Ubuntu'))

    expect(add).toHaveBeenCalledWith({ distro: 'Ubuntu', startIfStopped: true })
    expect(mocks.updateSettingsOrThrow).toHaveBeenCalledWith({ experimentalWslHosts: true })
    expect(onConnected).toHaveBeenCalledWith('wsl:ubuntu')
    expect(result.current.connectingDistro).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('reconnects a registered distro instead of adding it again', async () => {
    listDistros.mockResolvedValue([{ ...ubuntu, environmentId: 'existing-ubuntu' }])
    mocks.settings.experimentalWslHosts = true
    const onConnected = vi.fn()
    const { result } = renderHook(() => useAddRepoWslDistros({ open: true, onConnected }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(() => result.current.connect('Ubuntu'))
    expect(connect).toHaveBeenCalledWith({ environmentId: 'existing-ubuntu' })
    expect(add).not.toHaveBeenCalled()
    expect(onConnected).toHaveBeenCalledWith('existing-ubuntu')
  })

  it('keeps the current host on failure and lets the user retry', async () => {
    add.mockResolvedValueOnce({ ok: false, kind: 'failed', message: 'Distro could not start' })
    const onConnected = vi.fn()
    const { result } = renderHook(() => useAddRepoWslDistros({ open: true, onConnected }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(() => result.current.connect('Ubuntu'))
    expect(result.current.error).toBe('Distro could not start')
    expect(onConnected).not.toHaveBeenCalled()
    await act(() => result.current.connect('Ubuntu'))
    expect(onConnected).toHaveBeenCalledWith('wsl:ubuntu')
    expect(result.current.error).toBeNull()
  })

  it('does not select a late result after the picker closes or start another distro concurrently', async () => {
    let finishAdd: ((result: WslHostAddResult) => void) | undefined
    add.mockImplementationOnce(
      () =>
        new Promise<WslHostAddResult>((resolve) => {
          finishAdd = resolve
        })
    )
    const onConnected = vi.fn()
    const { result, rerender } = renderHook(
      ({ open }) => useAddRepoWslDistros({ open, onConnected }),
      { initialProps: { open: true } }
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    let operation: Promise<void> | undefined
    act(() => {
      operation = result.current.connect('Ubuntu')
    })
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1))
    await act(() => result.current.connect('Ubuntu'))
    expect(add).toHaveBeenCalledTimes(1)
    rerender({ open: false })
    await act(async () => {
      finishAdd?.({ ok: true, environmentId: 'wsl:ubuntu' })
      await operation
    })
    expect(onConnected).not.toHaveBeenCalled()
  })

  it('does not start WSL when enabling the setting fails', async () => {
    mocks.updateSettingsOrThrow.mockRejectedValue(new Error('Could not save settings'))
    const { result } = renderHook(() => useAddRepoWslDistros({ open: true, onConnected: vi.fn() }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(() => result.current.connect('Ubuntu'))
    expect(result.current.error).toBe('Could not save settings')
    expect(add).not.toHaveBeenCalled()
  })

  it('does not start an unsupported distro or a host without server files', async () => {
    listDistros.mockResolvedValue([{ ...ubuntu, version: 1 }])
    const { result, rerender } = renderHook(() =>
      useAddRepoWslDistros({ open: true, onConnected: vi.fn() })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(() => result.current.connect('Ubuntu'))
    expect(add).not.toHaveBeenCalled()
    expect(mocks.updateSettingsOrThrow).not.toHaveBeenCalled()
    mocks.serverFilesMissing = true
    rerender()
    await act(() => result.current.connect('Ubuntu'))
    expect(result.current.error).toContain('server files missing')
    expect(add).not.toHaveBeenCalled()
  })
})
