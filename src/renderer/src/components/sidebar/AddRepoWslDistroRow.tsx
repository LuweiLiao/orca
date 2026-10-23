import { Loader2 } from 'lucide-react'
import { CommandItem } from '@/components/ui/command'
import { translate } from '@/i18n/i18n'
import { wslHostEnvironmentLabel, type WslHostDistro } from '../../../../shared/wsl-host-types'
import { wslDistroStateLabel } from './AddWslHostFormPanel'
import { getWslHostRowServerFilesMissingDetail } from './wsl-host-row-status'

export function AddRepoWslDistroRow({
  distro,
  connectingDistro,
  serverFilesMissing,
  onSelect
}: {
  distro: WslHostDistro
  connectingDistro?: string | null
  serverFilesMissing: boolean
  onSelect?: (distro: string) => void
}) {
  const isConnecting = connectingDistro === distro.name
  return (
    <CommandItem
      value={wslHostEnvironmentLabel(distro.name)}
      disabled={serverFilesMissing || distro.version === 1 || Boolean(connectingDistro)}
      onSelect={() => onSelect?.(distro.name)}
      layout="host"
    >
      <span className="mt-0.5 size-3 shrink-0">
        {isConnecting ? <Loader2 className="size-3 animate-spin" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{wslHostEnvironmentLabel(distro.name)}</span>
        <span className="mt-0.5 block truncate text-2xs text-muted-foreground">
          {serverFilesMissing
            ? getWslHostRowServerFilesMissingDetail()
            : wslDistroStateLabel(distro)}
        </span>
      </span>
      {distro.version !== 1 && !serverFilesMissing ? (
        <span className="shrink-0 self-center text-2xs text-muted-foreground">
          {isConnecting
            ? translate('auto.components.sidebar.AddWslHostFormPanel.adding', 'Setting up…')
            : translate('auto.components.settings.wslHosts.connect', 'Connect')}
        </span>
      ) : null}
    </CommandItem>
  )
}
