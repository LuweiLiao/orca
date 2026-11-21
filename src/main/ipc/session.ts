import { ipcMain } from 'electron'
import type { Store } from '../persistence/loading-store/store'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { parseTerminalSurfaceCloseTarget } from '../../shared/workspace-layout/terminal-surfaces/terminal-surface-close-target'
import { isFrozenOrcadSourceSessionPartition } from '../persistence/migrating-orcad-catalog/source/catalog/orcad-source-visibility'
import { isWslMoveWindowWriteHeld } from '../persistence/moving-wsl-projects/quiescence/wsl-move-window-write-hold'
import { visibleSessionHostIds } from '../persistence/migrating-orcad-catalog/retained-source/orcad-retained-source-session'
import { markAgentLaunchesClosedByUser } from '../agent-launch/agent-launch-pane-attachment'
import { windowViewPatchForMain, windowViewSaveForMain } from '../persistence/window-save-view'
import { windowWrittenWorkspaces } from '../persistence/window-session-written-workspaces'
import { reportWindowSaveDrift } from '../persistence/window-save-divergence'
import { windowSaveKeepingMainSleepRecords } from '../persistence/window-save-sleep-records'
import {
  windowSaveKeepingRelayOwnership,
  type WindowSessionSetOptions
} from '../persistence/window-save-relay-ownership'
import {
  carriedRelayStatus,
  parseCarriedDesktopRelays,
  registerDesktopRelayHandlers
} from './session-desktop-relays'
import type { WorkspaceSessionSetResult } from '../../shared/workspace-session/desktop-relay-write'
import type { DesktopRelayHostWrite } from '../../shared/workspace-session/desktop-relay-ownership'
import { isNoopWindowSessionPatch } from '../persistence/window-session-patch-noop'
import { noteWindowSessionSaveUnchanged } from '../browser/extensions/tabs-and-windows/browser-extension-discarded-tabs'
import { ORCA_LAYOUT_OWNER_IS_MAIN } from '../../shared/workspace-layout/layout-owner-switch'
import {
  LOCAL_EXECUTION_HOST_ID,
  normalizeExecutionHostId
} from '../../shared/execution-host/execution-host'
import type {
  WorkspaceSessionPatch,
  WorkspaceSessionState
} from '../../shared/workspace-session/workspace-session-state-types'
import {
  applyWorkspaceSessionEntriesPatch,
  fieldsStoredDifferently,
  type WorkspaceSessionEntriesPatch,
  type WorkspaceSessionEntriesPatchResult
} from '../../shared/workspace-session/workspace-session-entries-patch'
import type { WebContents } from 'electron'
import {
  desktopWindowSession,
  saveDesktopWindowSessionView
} from '../persistence/desktop-windows/desktop-window-state'
import {
  prepareDesktopWindowSessionWrite,
  readDesktopWindowSession
} from '../persistence/desktop-windows/desktop-window-session-writes'

export function registerSessionHandlers(store: Store, runtime: OrcaRuntimeService): void {
  // Why: renderer saves would change a fenced host's frozen source partition, or write back what a
  // WSL move rewrote under this window before main reloads it.
  const isFenced = (hostId?: string | null): boolean =>
    isFrozenOrcadSourceSessionPartition(store, hostId) || isWslMoveWindowWriteHeld()

  // Optional hostId preserves local-partition behavior for older renderers.
  // Native desktop windows each read their own view over the shared session.
  ipcMain.handle('session:get', (event, hostId?: string | null) => {
    return readDesktopWindowSession(store, event?.sender, hostId)
  })

  // Repo catalogs omit folder-only SSH hosts; enumerate session partitions directly (#12723).
  ipcMain.handle('session:list-host-ids', () => {
    return visibleSessionHostIds(store, store.getWorkspaceSessionHostIds())
  })

  // Main owns layout membership; merge the window's view and facts, then report layout drift.
  const sessionForMain = (args: WorkspaceSessionState, hostId: string | null | undefined) => {
    const stored = store.getWorkspaceSession(hostId)
    reportWindowSaveDrift(stored, args, hostId, 'session:set')
    return windowViewSaveForMain(stored, args, hostId, (session, partition) =>
      runtime.shutdownReconnectFactsFor(session, partition)
    )
  }
  /** `entries`: the window's changed keys, when it sent only those. */
  const patchForMain = (
    args: WorkspaceSessionPatch,
    hostId: string | null | undefined,
    entries?: WorkspaceSessionEntriesPatch
  ) => {
    const stored = store.getWorkspaceSession(hostId)
    reportWindowSaveDrift(stored, { ...stored, ...args }, hostId, 'session:patch')
    const { patch, touched } = windowViewPatchForMain(stored, args, hostId, (session, partition) =>
      runtime.shutdownReconnectFactsFor(session, partition)
    )
    // Main merges layout fields itself, so the keys it wrote bound what the save changes.
    return {
      save: patch,
      written: touched ? windowWrittenWorkspaces(stored, patch, touched, entries) : undefined
    }
  }

  const relayApplier = registerDesktopRelayHandlers(store, isFenced)

  ipcMain.handle(
    'session:set',
    (
      event,
      args: WorkspaceSessionState,
      hostId?: string | null,
      options?: WindowSessionSetOptions
    ): WorkspaceSessionSetResult => {
      if (isFenced(hostId)) {
        return { status: 'skipped' }
      }
      const windowWrite = prepareDesktopWindowSessionWrite(
        store,
        event?.sender,
        { kind: 'set', session: args },
        hostId
      )
      saveDesktopWindowSessionView(store, event?.sender, args, hostId)
      const stored = store.getWorkspaceSession(hostId)
      const save = windowSaveKeepingRelayOwnership(
        stored,
        ORCA_LAYOUT_OWNER_IS_MAIN ? args : (windowWrite?.shared ?? args),
        'set',
        options
      )
      const next = ORCA_LAYOUT_OWNER_IS_MAIN
        ? sessionForMain(save, hostId)
        : windowSaveKeepingMainSleepRecords(stored, save, 'set')
      // Main-owned layout recomputes relay ids itself; the window never sends them separately there.
      const relays = ORCA_LAYOUT_OWNER_IS_MAIN
        ? null
        : parseCarriedDesktopRelays(options?.carried, hostId)
      const relayHostId = normalizeExecutionHostId(hostId) ?? LOCAL_EXECUTION_HOST_ID
      const applied = relays ? relayApplier([relayHostId])(relayHostId, relays, next) : null
      // One publish for the snapshot and the relay ids that ride with it.
      store.setWorkspaceSession({ ...next, ...applied?.patch }, hostId)
      applied?.stored()
      windowWrite?.commit()
      const status = carriedRelayStatus(applied)
      return status ? { status: 'applied', relays: status } : { status: 'applied' }
    }
  )

  /** `relays`: the window's relay ids for this partition, applied by ownership in the same publish. */
  const patchWindowSession = (
    toPatch: (stored: WorkspaceSessionState) => WorkspaceSessionPatch,
    hostId: string | null | undefined,
    entries?: WorkspaceSessionEntriesPatch,
    relays?: DesktopRelayHostWrite | null,
    sender?: WebContents
  ): Omit<WorkspaceSessionEntriesPatchResult, 'normalizedFields'> => {
    if (isFenced(hostId)) {
      return { status: 'skipped' }
    }
    const stored = store.getWorkspaceSession(hostId)
    const requested = toPatch(sender ? desktopWindowSession(store, sender, hostId) : stored)
    const windowWrite = prepareDesktopWindowSessionWrite(
      store,
      sender,
      { kind: 'patch', patch: requested },
      hostId
    )
    saveDesktopWindowSessionView(
      store,
      sender,
      windowWrite?.window ?? { ...desktopWindowSession(store, sender, hostId), ...requested },
      hostId
    )
    // A native window's patch reaches the shared session only through its shared records.
    const windowPatch = windowWrite && !ORCA_LAYOUT_OWNER_IS_MAIN ? windowWrite.shared : requested
    const args = windowSaveKeepingRelayOwnership(stored, windowPatch, 'patch')
    const { save, written } = ORCA_LAYOUT_OWNER_IS_MAIN
      ? patchForMain(args, hostId, entries)
      : { save: windowSaveKeepingMainSleepRecords(stored, args, 'patch'), written: undefined }
    // Main-owned layout recomputes relay ids itself; the window never sends them separately there.
    const relayHostId = normalizeExecutionHostId(hostId) ?? LOCAL_EXECUTION_HOST_ID
    const applied =
      relays && !ORCA_LAYOUT_OWNER_IS_MAIN
        ? relayApplier([relayHostId])(relayHostId, relays, { ...stored, ...save })
        : null
    const relayStatus = carriedRelayStatus(applied)
    const withRelays = relayStatus ? { relays: relayStatus } : {}
    if (!ORCA_LAYOUT_OWNER_IS_MAIN && isNoopWindowSessionPatch(stored, save)) {
      if (applied?.patch) {
        store.patchWorkspaceSessionRelays(applied.patch, hostId, applied.changedTabIds)
        applied.stored()
        windowWrite?.commit()
        return { status: 'applied', ...withRelays }
      }
      windowWrite?.commit()
      noteWindowSessionSaveUnchanged(hostId)
      return { status: 'unchanged', ...withRelays }
    }
    // One publish for the entries and the relay ids that ride with them.
    store.patchWorkspaceSession({ ...save, ...applied?.patch }, hostId, written)
    applied?.stored()
    windowWrite?.commit()
    return { status: 'applied', ...withRelays }
  }

  ipcMain.handle('session:patch', (event, args: WorkspaceSessionPatch, hostId?: string | null) => {
    patchWindowSession(() => args, hostId, undefined, undefined, event?.sender)
  })

  // Changed keys only: rebuilt into whole fields from the stored partition, then saved as a patch.
  ipcMain.handle(
    'session:patch-entries',
    (
      event,
      args: WorkspaceSessionEntriesPatch,
      hostId?: string | null,
      relays?: unknown
    ): WorkspaceSessionEntriesPatchResult => {
      const result = patchWindowSession(
        (stored) => applyWorkspaceSessionEntriesPatch(stored, args),
        hostId,
        args,
        parseCarriedDesktopRelays(relays, hostId),
        event?.sender
      )
      if (result.status === 'skipped') {
        return result
      }
      // Normalization, fences and main's sleep records can store something else, saved or not.
      const normalizedFields = fieldsStoredDifferently(
        desktopWindowSession(store, event?.sender, hostId),
        args
      )
      return normalizedFields.length > 0 ? { ...result, normalizedFields } : result
    }
  )

  // Window saves cannot shrink main-owned membership; closes must commit explicitly.
  ipcMain.handle(
    'session:close-terminal-surface',
    (_event, args: { worktreeId?: unknown; target?: unknown; reason?: unknown } | undefined) => {
      const target = parseTerminalSurfaceCloseTarget(args?.target)
      if (typeof args?.worktreeId !== 'string' || !target) {
        throw new Error('invalid_terminal_surface')
      }
      // Only main may close tabs for process exit.
      const reason = args.reason === 'cleanup' ? 'cleanup' : 'user'
      if (reason === 'user') {
        markAgentLaunchesClosedByUser(args.worktreeId, target)
      }
      return runtime.closeTerminalSurfaceFromRenderer({
        worktreeId: args.worktreeId,
        target,
        reason
      })
    }
  )

  ipcMain.handle('session:flush', () => {
    // Lifecycle success requires durable writes; Store.flush only logs failures.
    return store.flushPendingOrThrowAsync()
  })

  ipcMain.handle(
    'session:read-terminal-scrollback',
    (_event, args: { ref?: unknown } | undefined) =>
      typeof args?.ref === 'string' ? store.readTerminalScrollbackSnapshotAsync(args.ref) : null
  )
}
