import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import { useWslDistroList } from './use-wsl-distro-list'
import { wslHostsAvailable, useWslHostServerFilesMissing } from './use-wsl-hosts-enabled'
import { getWslHostServerFilesMissingLabel } from './wsl-host-row-status'

export function useAddRepoWslDistros({
  open,
  onConnected
}: {
  open: boolean
  onConnected: (environmentId: string) => void
}) {
  const list = useWslDistroList(open && wslHostsAvailable())
  const serverFilesMissing = useWslHostServerFilesMissing()
  const [connectingDistro, setConnectingDistro] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)
  const lifetime = useRef({ generation: 0 }).current
  const onConnectedRef = useRef(onConnected)
  onConnectedRef.current = onConnected

  useEffect(() => {
    if (open) {
      setError(null)
    }
    return () => {
      lifetime.generation++
    }
  }, [lifetime, open])

  const connect = async (distro: string): Promise<void> => {
    const api = window.api.runtimeEnvironments?.wslHosts
    if (!api || inFlight.current) {
      return
    }
    if (serverFilesMissing) {
      setError(getWslHostServerFilesMissingLabel())
      return
    }
    const selected = list.distros.find((candidate) => candidate.name === distro)
    if (!selected || selected.version === 1) {
      return
    }
    const currentGeneration = lifetime.generation
    inFlight.current = true
    setConnectingDistro(distro)
    setError(null)
    try {
      const store = useAppStore.getState()
      if (store.settings?.experimentalWslHosts !== true) {
        await store.updateSettingsOrThrow({ experimentalWslHosts: true })
      }
      let environmentId = selected.environmentId
      if (environmentId) {
        await api.connect({ environmentId })
      } else {
        const result = await api.add({ distro, startIfStopped: true })
        if (!result.ok) {
          throw new Error(result.message)
        }
        environmentId = result.environmentId
      }
      store.setRuntimeEnvironments(await window.api.runtimeEnvironments.list())
      await store.readRuntimeHostStatusSnapshots()
      list.refresh()
      if (currentGeneration === lifetime.generation) {
        onConnectedRef.current(environmentId)
      }
    } catch (cause) {
      if (currentGeneration === lifetime.generation) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      inFlight.current = false
      setConnectingDistro(null)
    }
  }

  return {
    distros: list.distros,
    loading: list.loading,
    error: error ?? list.error,
    connectingDistro,
    serverFilesMissing,
    connect
  }
}
