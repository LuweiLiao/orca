import type { MobileRelayStatusDetail } from '../../../shared/remote-runtime/relay/mobile-relay-status'
import { broadcastDesktopRendererEvent } from '../../window/native-windows/desktop-renderer-registry'
import { mainProcessState as state } from '../main-process-state'

export function getDesktopRelayStatus(): MobileRelayStatusDetail {
  return { ...state.core.desktopRelayStatus }
}

export function publishDesktopRelayStatus(
  status: MobileRelayStatusDetail['status'],
  cellUrl?: string,
  clockOffsetMs?: number
): void {
  state.core.desktopRelayStatus = {
    status,
    ...(cellUrl === undefined ? {} : { cellUrl }),
    ...(clockOffsetMs === undefined ? {} : { clockOffsetMs })
  }
  // Every native window shows relay status; a destroyed window is skipped, not sent to.
  broadcastDesktopRendererEvent('mobile:relayStatusChanged', getDesktopRelayStatus())
}
