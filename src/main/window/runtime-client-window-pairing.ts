import type { DeviceEntry } from '../runtime/device-entry'
import type { RuntimeRpcPairing } from '../runtime/runtime-rpc/runtime-rpc-pairing'
import { WS_BIND_HOST_LOOPBACK } from '../runtime/runtime-rpc/runtime-rpc-pairing-types'
import type { RuntimeClientWindowRecord } from './runtime-client-window-records'
import { RUNTIME_CLIENT_WINDOW_WORKTREE_PARAM } from '../../shared/runtime-client-window-fragment'

export type RuntimeClientWindowPairingHost = {
  createPairingOffer: (args: {
    address: string
    name: string
    scope: 'runtime'
    reach: 'this-computer'
  }) => ReturnType<RuntimeRpcPairing['createPairingOffer']>
  getDeviceRegistry: () => {
    getDevice: (deviceId: string) => DeviceEntry | null
    listDevices: () => readonly DeviceEntry[]
  } | null
  getWebClientEntryUrl: (address: string) => string | null
}

export type RuntimeClientWindowEntry =
  | { ok: true; url: string; deviceId: string; webClientOrigin: string }
  | { ok: false; reason: string }

/**
 * Where a slot's window should load. A slot whose grant is still authorized reconnects from the
 * pairing its persistent partition already stored, so reopening it never mints another device row.
 */
export function resolveRuntimeClientWindowEntry(
  host: RuntimeClientWindowPairingHost,
  record: RuntimeClientWindowRecord | undefined,
  slot: number
): RuntimeClientWindowEntry {
  const entryUrl = host.getWebClientEntryUrl(WS_BIND_HOST_LOOPBACK)
  if (entryUrl && record?.deviceId) {
    const webClientOrigin = new URL(entryUrl).origin
    // Why the origin check: browser storage is per origin, so a runtime on a new port lost the pairing.
    if (
      record.webClientOrigin === webClientOrigin &&
      isSlotGrantAuthorized(host.getDeviceRegistry(), record.deviceId)
    ) {
      return { ok: true, url: entryUrl, deviceId: record.deviceId, webClientOrigin }
    }
  }
  // Why no rotate: rotation deletes every pending runtime link, including one Settings just handed out.
  const offer = host.createPairingOffer({
    address: WS_BIND_HOST_LOOPBACK,
    name: `Orca 窗口 ${slot}`,
    scope: 'runtime',
    reach: 'this-computer'
  })
  if (!offer.available) {
    return { ok: false, reason: `${offer.reason}: ${offer.guidance}` }
  }
  if (!offer.webClientUrl) {
    return { ok: false, reason: 'web_client_unavailable: the bundled web client is not served' }
  }
  return {
    ok: true,
    url: offer.webClientUrl,
    deviceId: offer.deviceId,
    webClientOrigin: new URL(offer.webClientUrl).origin
  }
}

// Why: a seen token row or its device-key fork proves the slot's profile stored and used it.
function isSlotGrantAuthorized(
  registry: ReturnType<RuntimeClientWindowPairingHost['getDeviceRegistry']>,
  deviceId: string
): boolean {
  if (!registry) {
    return false
  }
  const tokenRow = registry.getDevice(deviceId)
  return (
    (tokenRow !== null && tokenRow.lastSeenAt > 0) ||
    registry.listDevices().some((device) => device.forkedFrom === deviceId)
  )
}

export function withWorktreeFragment(url: string, worktreeId: string | undefined): string {
  if (!worktreeId) {
    return url
  }
  const parsed = new URL(url)
  const fragment = parsed.hash.replace(/^#/, '')
  const worktree = `${RUNTIME_CLIENT_WINDOW_WORKTREE_PARAM}=${encodeURIComponent(worktreeId)}`
  parsed.hash = fragment ? `${fragment}&${worktree}` : worktree
  return parsed.toString()
}
