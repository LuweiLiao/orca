import { nativeTheme, type BrowserWindow } from 'electron'
import type { Store } from '../../persistence/loading-store/store'
import type { NativeSettingsProjection } from '../../core-desktop/native-settings-projection'
import { registerRepoHandlers } from '../../ipc/repos'
import { setRepoRemoteClientNotifier } from '../../ipc/repos/repos-changed-notification'
import { setWorktreeCatalogRemoteClientNotifier } from '../../ipc/worktrees/listing/watched-worktree-catalog-notification'
import { registerWorktreeHandlers } from '../../ipc/worktrees'
import { registerWorkspaceCleanupHandlers } from '../../ipc/workspace-cleanup/workspace-cleanup'
import { registerPtyHandlers } from '../../ipc/pty/register-handlers'
import type {
  CodexHomePtySpawnedLifecycleArgs,
  GetSelectedCodexHomePath,
  PrepareCodexSessionResume
} from '../../ipc/pty/host-env/types'
import { registerDaemonManagementHandlers } from '../../ipc/pty/ipc/pty-management'
import { registerSshHandlers } from '../../ipc/ssh/ssh'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import type { RuntimeWorktreeLifecycleEvent } from '../../runtime/workspaces/lifecycle/worktree-lifecycle-event'
import type {
  PreQuitCleanupFailureMode,
  UpdateInstallMode
} from '../../updater/lifecycle/updater-state'
import { scheduleHistoryGc } from '../../pty/history/terminal-history-gc'
import { openCodeHookService, openCode2HookService } from '../../opencode/status-hooks/hook-service'
import { listLiveDaemonPtyIds } from '../../daemon/providers/lifecycle/daemon-provider-state'
import { hydrateLocalPtyRegistryAtBoot } from '../../memory/hydrate-local-pty-registry'
import type { ClaudeRuntimeAuthPreparation } from '../../claude-accounts/runtime-auth/runtime-auth-types'
import { getKnownWorktreeIdsForHistoryGc } from '../../pty/history/history-gc-worktree-ids'
import type { ClaudeAccountSelectionTarget } from '../../claude-accounts/selection/runtime-selection'
import { scheduleMainWindowAutoUpdaterSetup } from '../../updater/lifecycle/main-window-updater'
import type { NativeDesktopPtyDelivery } from '../../ipc/pty/delivery/native-desktop-delivery'
import { preferredNativeDesktopWindow } from '../../window/native-windows/native-desktop-windows'

export type MainWindowServiceOptions = {
  deferSshInitialization?: boolean
  hostInitialization?: Promise<void>
  prepareCodexSessionResume?: PrepareCodexSessionResume
  awaitLocalPtyStartup?: () => Promise<void>
  awaitLocalPtyProviderStartup?: () => Promise<void>
  onBeforeRendererReload?: (args: { webContentsId: number; ignoreCache: boolean }) => void
  // Skip the crash-recovery reload in PTY orphan sweeping (#5787).
  isRecoveryReloadInFlight?: (webContentsId: number) => boolean
  onCodexHomePtySpawned?: (args: CodexHomePtySpawnedLifecycleArgs) => void
  onPtyExit?: (id: string, exitSequence: number) => void
  onBeforeUpdateQuit?: () => void | Promise<void>
  onBeforeUpdateQuitFailure?: PreQuitCleanupFailureMode
  updateInstallMode?: UpdateInstallMode
  onWorktreeLifecycle?: (event: RuntimeWorktreeLifecycleEvent) => void
}

type RuntimeServiceOptions = {
  getSelectedCodexHomePath?: GetSelectedCodexHomePath
  prepareClaudeAuth?: (
    target?: ClaudeAccountSelectionTarget
  ) => Promise<ClaudeRuntimeAuthPreparation>
  options?: MainWindowServiceOptions
}

/** Process-wide handlers and the PTY source: once per runtime, not once per native window. */
export async function attachRuntimeServicesOnce(
  mainWindow: BrowserWindow,
  store: Store,
  nativeSettings: NativeSettingsProjection,
  runtime: OrcaRuntimeService,
  delivery: NativeDesktopPtyDelivery | undefined,
  options: RuntimeServiceOptions
): Promise<void> {
  registerRepoHandlers(mainWindow, store, runtime)
  // Repo IPC mutations must invalidate paired-client catalogs too (#11994).
  setRepoRemoteClientNotifier(runtime)
  setWorktreeCatalogRemoteClientNotifier(runtime)
  registerWorktreeHandlers(mainWindow, store, runtime, {
    onWorktreeLifecycle: options.options?.onWorktreeLifecycle
  })
  registerWorkspaceCleanupHandlers(store, () => runtime.getExistingOrchestrationDb())
  registerPtyHandlers(
    delivery?.source ?? mainWindow,
    runtime,
    options.getSelectedCodexHomePath,
    () => store.getSettings(),
    options.prepareClaudeAuth,
    store,
    {
      prepareCodexSessionResume: options.options?.prepareCodexSessionResume,
      awaitLocalPtyStartup: options.options?.awaitLocalPtyStartup,
      awaitLocalPtyProviderStartup: options.options?.awaitLocalPtyProviderStartup,
      isRecoveryReloadInFlight: options.options?.isRecoveryReloadInFlight,
      onCodexHomePtySpawned: options.options?.onCodexHomePtySpawned,
      onPtyExit: options.options?.onPtyExit,
      systemPrefersDark: () => nativeTheme.shouldUseDarkColors,
      nativeWindowDelivery: delivery
        ? {
            sessionFor: (renderer) => delivery.sessionFor(renderer),
            acceptData: (payload) => delivery.acceptData(payload),
            attachSource: (session) => delivery.attachSource(session),
            claim: (renderer, id) => delivery.claim(renderer, id),
            canResize: (renderer, id) => delivery.canResize(renderer, id),
            canReply: (renderer, id) => delivery.canReply(renderer, id),
            updateHint: (renderer, id, hint, value) =>
              delivery.updateHint(renderer, id, hint, value)
          }
        : undefined
    }
  )
  // Register after PTY handlers so macOS reactivation reinstalls management IPC (docs/daemon-staleness-ux.md §Phase 1).
  registerDaemonManagementHandlers()
  // Background git worktree list can trigger protected-folder prompts on macOS; use remembered IDs.
  scheduleHistoryGc(async () => {
    // An unknown daemon inventory keeps every session folder but still runs the rest of the GC.
    const liveSessionIds = await listLiveDaemonPtyIds().catch(() => null)
    return {
      ...getKnownWorktreeIdsForHistoryGc(store),
      liveSessionIds: liveSessionIds && new Set(liveSessionIds)
    }
  })
  openCodeHookService.configDirGc.schedule(listLiveDaemonPtyIds)
  openCode2HookService.configDirGc.schedule(listLiveDaemonPtyIds)
  const localPtyProviderStartupReady = options.options?.awaitLocalPtyProviderStartup?.()
  if (localPtyProviderStartupReady) {
    void localPtyProviderStartupReady
      .then(() => hydrateLocalPtyRegistryAtBoot(store))
      .catch((error) => {
        console.warn(
          '[memory] Deferred pty-registry hydration skipped:',
          error instanceof Error ? error.message : String(error)
        )
      })
  } else {
    void hydrateLocalPtyRegistryAtBoot(store)
  }
  const sshReady = registerSshHandlers(
    store,
    () => preferredNativeDesktopWindow() ?? mainWindow,
    runtime,
    options.options?.hostInitialization
  )
  if (options.options?.deferSshInitialization) {
    void sshReady.catch((error: unknown) =>
      console.warn('[startup] SSH initialization failed:', error)
    )
  } else {
    await sshReady
  }
  scheduleMainWindowAutoUpdaterSetup(mainWindow, nativeSettings, options.options)
}
