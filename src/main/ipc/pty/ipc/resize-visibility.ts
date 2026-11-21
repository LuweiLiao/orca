import { getPtyIpc } from '../pty-host-bindings'
import { redactPtyIdForDiagnostics } from '../../../../shared/terminal/pty/diagnostics/pty-delivery-diagnostics'
import { installTerminalViewAttributesIpc } from './terminal-view-attributes-ipc'
import {
  consumeHiddenRendererPtyDropMemory,
  recordVisibleReportUnhideEpisode,
  setRendererPtyDeliveryInterest,
  shouldDropHiddenRendererPtyData,
  shouldVisibleViewRevealHiddenRendererPty
} from '../delivery/pty-hidden-delivery-gate'
import { tryGetProviderForPty, closeStartupQueryAuthorityForPty } from '../provider/registry'
import {
  activeRendererPtys,
  invalidatePendingPtyDrainPolicy,
  invalidatePendingPtyDrainPriority,
  ptySizes,
  rendererVisibilityKnownPtys,
  visibleRendererPtys
} from '../delivery/visibility-state'
import { mainDeliveryBreadcrumbs } from '../delivery/debug'
import {
  revealHiddenRendererPty,
  updateHiddenRendererPtyClaim,
  type HiddenRendererPtyClaim
} from '../delivery/hidden-transition'
import { installPtyRendererDeliveryCreditIpc } from './renderer-delivery-credit'
import { acknowledgePaintedColdRestore } from './painted-cold-restore-ack'
import type { PaintedRestoreAck } from '../../../../shared/terminal/replay/painted-restore-ack'
import type { PtyIpcSession } from '../session'

export function installPtyResizeVisibilityIpc(session: PtyIpcSession): void {
  const ipcMain = getPtyIpc()
  const { runtime } = session
  const native = session.options?.nativeWindowDelivery

  // Fire-and-forget resize avoids an empty acknowledgement round trip.
  ipcMain.removeAllListeners('pty:resize')
  ipcMain.on('pty:resize', (event, args: { id: string; cols: number; rows: number }) => {
    // Only the window that owns a shared terminal's size may resize it.
    if (native && !native.canResize(event.sender, args.id)) {
      return
    }
    // Fit overrides remeasure all panes; suppress the cascade so background full-width measurements cannot resize PTYs.
    if (runtime?.isResizeSuppressed()) {
      return
    }
    // Enforce viewer-owned geometry in main too; renderer presence state lags by one IPC hop (docs/mobile-presence-lock.md).
    const mobileOwnsResize = runtime?.getDriver(args.id).kind === 'mobile'
    const remoteDesktopOwnsResize = runtime?.isRemoteDesktopResizeDriven?.(args.id) === true
    if (mobileOwnsResize || remoteDesktopOwnsResize) {
      if (remoteDesktopOwnsResize) {
        runtime?.recordRemoteDesktopHostReclaimTarget(args.id, args.cols, args.rows)
      }
      return
    }
    const provider = tryGetProviderForPty(args.id)
    if (!provider) {
      return
    }
    try {
      provider.resize(args.id, args.cols, args.rows)
    } catch {
      return
    }
    ptySizes.set(args.id, { cols: args.cols, rows: args.rows })
    runtime?.onExternalPtyResize(args.id, args.cols, args.rows)
  })

  // Measurement-only reports update desktop restore geometry while viewer-owned resizing is blocked (docs/mobile-fit-hold.md).
  ipcMain.removeAllListeners('pty:reportGeometry')
  ipcMain.on('pty:reportGeometry', (event, args: { id: string; cols: number; rows: number }) => {
    if (native && !native.canResize(event.sender, args.id)) {
      return
    }
    runtime?.recordRendererGeometry(args.id, args.cols, args.rows)
  })

  // Painted-restore acknowledgement clears daemon cold-restore cache without a response.
  ipcMain.removeAllListeners('pty:ackColdRestore')
  ipcMain.on('pty:ackColdRestore', (_event, args: Partial<PaintedRestoreAck> | undefined) => {
    acknowledgePaintedColdRestore(args, (pane, ptyId) =>
      Boolean(runtime?.isRestoredPaneBoundTo(pane, ptyId))
    )
  })

  // Snapshot requests may outlive their pane; retire drop memory only after painted restore (#15504).
  ipcMain.removeAllListeners('pty:hiddenOutputRestoreApplied')
  ipcMain.on(
    'pty:hiddenOutputRestoreApplied',
    (_event, args: { id?: unknown; hiddenDropEpisode?: unknown }) => {
      if (typeof args?.id !== 'string' || !args.id) {
        return
      }
      const episode =
        typeof args.hiddenDropEpisode === 'number' ? args.hiddenDropEpisode : undefined
      consumeHiddenRendererPtyDropMemory(args.id, episode)
    }
  )

  installPtyRendererDeliveryCreditIpc(session)

  ipcMain.removeAllListeners('pty:setActiveRendererPty')
  ipcMain.on('pty:setActiveRendererPty', (event, args: { id: string; active: boolean }) => {
    if (typeof args.id !== 'string' || !args.id) {
      return
    }
    // Native windows share a terminal; any window's claim keeps it active.
    const active = native?.updateHint(event.sender, args.id, 'active', args.active) ?? args.active
    // Active panes get scheduling priority; inactive ingestion, state and notifications continue.
    if (active) {
      if (activeRendererPtys.has(args.id)) {
        return
      }
      activeRendererPtys.add(args.id)
    } else if (!activeRendererPtys.delete(args.id)) {
      return
    }
    invalidatePendingPtyDrainPriority(args.id)
  })

  ipcMain.removeAllListeners('pty:setRendererPtyVisible')
  ipcMain.on('pty:setRendererPtyVisible', (event, args: { id: string; visible: boolean }) => {
    if (typeof args.id !== 'string' || !args.id) {
      return
    }
    const visible =
      native?.updateHint(event.sender, args.id, 'visible', args.visible) ?? args.visible
    // Preserve hidden-at-production origin through batching even if visibility changes before flush.
    rendererVisibilityKnownPtys.add(args.id)
    if (visible) {
      visibleRendererPtys.add(args.id)
      closeStartupQueryAuthorityForPty(args.id)
      // Panes release main's runtime mark only on their own claim release or first gate sync; a pane
      // that synced before the mark, or never syncs the gate, would leave it stuck (#43972).
      if (shouldVisibleViewRevealHiddenRendererPty(args.id)) {
        mainDeliveryBreadcrumbs.record('visible-gate-unmark', {
          id: redactPtyIdForDiagnostics(args.id)
        })
        const episode = revealHiddenRendererPty(session, args.id, 'visibility-report')
        if (episode !== undefined) {
          recordVisibleReportUnhideEpisode(args.id, episode)
        }
        return
      }
    } else {
      visibleRendererPtys.delete(args.id)
    }
    session.syncPtyBackgroundedDelivery(args.id, 'visibility-report')
  })

  ipcMain.removeAllListeners('pty:setHiddenRendererPty')
  ipcMain.on('pty:setHiddenRendererPty', (event, args: HiddenRendererPtyClaim) => {
    if (typeof args?.id !== 'string' || !args.id) {
      return
    }
    // A terminal stays shown while any native window still shows it.
    const hidden = native?.updateHint(event.sender, args.id, 'hidden', args.hidden) ?? args.hidden
    updateHiddenRendererPtyClaim(session, { ...args, hidden })
  })

  installTerminalViewAttributesIpc(session)

  ipcMain.removeAllListeners('pty:setPtyDeliveryInterest')
  ipcMain.on('pty:setPtyDeliveryInterest', (event, args: { id: string; interested: boolean }) => {
    if (typeof args.id !== 'string' || !args.id) {
      return
    }
    const interested =
      native?.updateHint(event.sender, args.id, 'interest', args.interested) ?? args.interested
    // Raw-byte interests bypass hidden gating without changing daemon pacing during interest churn.
    const settings = session.getSettings?.()
    const wasDroppable = shouldDropHiddenRendererPtyData(args.id, settings)
    setRendererPtyDeliveryInterest(args.id, interested === true)
    if (wasDroppable !== shouldDropHiddenRendererPtyData(args.id, settings)) {
      invalidatePendingPtyDrainPolicy(args.id)
    }
  })

  ipcMain.removeAllListeners('pty:signal')
  ipcMain.on('pty:signal', (_event, args: { id: string; signal: string }) => {
    tryGetProviderForPty(args.id)
      ?.sendSignal(args.id, args.signal)
      .catch(() => {})
  })

  ipcMain.removeAllListeners('pty:clearBuffer')
  ipcMain.on('pty:clearBuffer', (_event, args: { id: string }) => {
    // Clear provider-side state so prompt repaint cannot reuse a stale cursor row.
    tryGetProviderForPty(args.id)
      ?.clearBuffer(args.id)
      .catch(() => {})
    runtime?.clearHeadlessTerminalBuffer(args.id).catch(() => {})
  })

  ipcMain.removeAllListeners('pty:resetInputModes')
  ipcMain.on('pty:resetInputModes', (_event, args: { id: string }) => {
    // Older daemon/relay rejection leaves its model modes until reattach.
    tryGetProviderForPty(args.id)
      ?.resetInputModes(args.id)
      .catch(() => {})
    runtime?.resetHeadlessTerminalInputModes(args.id).catch(() => {})
  })
}
