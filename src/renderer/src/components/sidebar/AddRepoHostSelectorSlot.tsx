import { useState } from 'react'
import { AddRepoHostSelector } from './AddRepoHostSelector'
import type { useAddRepoHostSelection } from './use-add-repo-host-selection'
import { AddRemoteHostDialog, type AddRemoteHostMode } from './AddRemoteHostDialog'
import { openWslHostsExperimentalSetting, useWslHostsEnabled } from './use-wsl-hosts-enabled'

export function AddRepoHostSelectorSlot({
  hostSelection
}: {
  hostSelection: ReturnType<typeof useAddRepoHostSelection>
}) {
  const [addRemoteHostMode, setAddRemoteHostMode] = useState<AddRemoteHostMode | null>(null)
  const wslHostsEnabled = useWslHostsEnabled()
  const { wsl } = hostSelection

  return (
    <>
      <AddRepoHostSelector
        hosts={hostSelection.hostOptions}
        selectedHostId={hostSelection.displayedHostId}
        open={hostSelection.hostSelectorOpen}
        onOpenChange={hostSelection.setHostSelectorOpen}
        onSelectHost={(hostId) => void hostSelection.handleSelectAddProjectHost(hostId)}
        onConnectHost={(hostId) => void hostSelection.handleConnectAddProjectHost(hostId)}
        onAddSshHost={() => setAddRemoteHostMode('ssh')}
        onAddRemoteServer={() => setAddRemoteHostMode('server')}
        onAddWslHost={wslHostsEnabled ? () => setAddRemoteHostMode('wsl') : undefined}
        onOpenWslHostsSetting={openWslHostsExperimentalSetting}
        wslDistros={wsl.distros}
        wslLoading={wsl.loading}
        wslError={wsl.error}
        connectingWslDistro={wsl.connectingDistro}
        wslServerFilesMissing={wsl.serverFilesMissing}
        onSelectWslDistro={(distro) => void wsl.connect(distro)}
      />
      <AddRemoteHostDialog mode={addRemoteHostMode} onOpenChange={setAddRemoteHostMode} />
    </>
  )
}
