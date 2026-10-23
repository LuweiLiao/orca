import { useAppStore } from '@/store'

/**
 * True on Windows desktops and enabled e2e fakes. Older preloads omit the API.
 */
export function wslHostsAvailable(): boolean {
  return typeof window !== 'undefined' && window.api?.runtimeEnvironments?.wslHosts !== undefined
}

/** True once main reported that this build lacks the files WSL hosts deploy from. */
export function useWslHostServerFilesMissing(): boolean {
  return useAppStore((s) => s.wslHostServerFiles === 'missing')
}

/** Available, and the user-level Experimental switch (shown only behind the gate) is on. */
export function useWslHostsEnabled(): boolean {
  const enabled = useAppStore((s) => s.settings?.experimentalWslHosts === true)
  return enabled && wslHostsAvailable()
}

/** Settings → Experimental → WSL distros as hosts. */
export function openWslHostsExperimentalSetting(): void {
  const { openSettingsPage, openSettingsTarget } = useAppStore.getState()
  openSettingsPage()
  openSettingsTarget({ pane: 'experimental', repoId: null, sectionId: 'wsl-hosts' })
}
