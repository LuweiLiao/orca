import { app, BrowserWindow } from 'electron'
import type { UIZoomDirection } from '../../../shared/app-lifecycle/windows/ui-zoom-level'
import { setMainUiLanguage } from '../../i18n/main-i18n'
import {
  registerAppMenu,
  rebuildAppMenu,
  getNextDefaultOnAppearanceSettingValue
} from '../../menu/register-app-menu'
import { zoomDashboardPopoutIfFocused } from '../../window/dashboard-popout-window'
import { zoomWorkspaceSpaceWindowIfFocused } from '../../window/workspace-space-window'
import { preferredDesktopRenderer } from '../../window/native-windows/desktop-renderer-registry'
import { openRuntimeClientWindowFromUserCommand } from '../../window/native-windows/runtime-client-window-open-command'
import { recordCrashBreadcrumb } from '../../crash-reporting/breadcrumbs/crash-breadcrumb-store'
import { mainProcessState as state } from '../main-process-state'
import {
  getAppMenuQuitHandlers,
  openSettingsFromSystemMenu,
  runUserInitiatedUpdateCheck,
  sendOpenCrashReport,
  sendOpenFeatureTour,
  sendOpenSetupGuide,
  sendOpenWorktreePalette
} from './main-window-actions'
import { ensureAutoUpdaterConfigured } from '../../updater/lifecycle/main-window-updater'
import { logStartupMilestone } from '../diagnostics/startup-diagnostics'
import { browserManager } from '../../browser/guest-lifecycle/manager/browser-manager'

// Auxiliary windows handle zoom directly; full desktop windows use their renderer.
function zoomFocusedWindowFromMenu(direction: UIZoomDirection): void {
  if (!zoomDashboardPopoutIfFocused(direction) && !zoomWorkspaceSpaceWindowIfFocused(direction)) {
    preferredDesktopRenderer()?.send('terminal:zoom', direction)
  }
}

function sendToFocusedDesktopRenderer(channel: string): void {
  preferredDesktopRenderer()?.send(channel)
}

export async function initializeMainProcessI18nAndMenu(): Promise<void> {
  const store = state.store
  if (!store) {
    throw new Error('Store must be initialized before menu')
  }
  await setMainUiLanguage(store.getSettings().uiLanguage)
  logStartupMilestone('i18n-ready')
  registerAppMenu({
    appMenuLabel: state.devInstanceIdentity?.name ?? app.name,
    ...getAppMenuQuitHandlers(),
    onCheckForUpdates: (options) => {
      ensureAutoUpdaterConfigured()
      runUserInitiatedUpdateCheck(options)
    },
    onBeforeReload: ({ ignoreCache, webContentsId }) => {
      if (state.mainWindow?.webContents.id === webContentsId) {
        state.expectedRendererReload.mark(webContentsId)
      }
      recordCrashBreadcrumb('manual_reload_requested', { ignoreCache })
    },
    onOpenSettings: openSettingsFromSystemMenu,
    onOpenWorktreePalette: (targetWindow) =>
      sendOpenWorktreePalette(targetWindow instanceof BrowserWindow ? targetWindow : null),
    toggleFocusedPageDevTools: (focused) => browserManager.toggleDevToolsOfFocusedPage(focused),
    onNewWindow: openRuntimeClientWindowFromUserCommand,
    onOpenSetupGuide: (targetWindow) => {
      recordCrashBreadcrumb('setup_guide_opened')
      sendOpenSetupGuide(targetWindow instanceof BrowserWindow ? targetWindow : null)
    },
    onOpenCrashReport: (targetWindow) => {
      recordCrashBreadcrumb('crash_report_opened')
      sendOpenCrashReport(targetWindow instanceof BrowserWindow ? targetWindow : null)
    },
    onOpenFeatureTour: (targetWindow) => {
      recordCrashBreadcrumb('feature_tour_opened')
      // Route to the invoking renderer so hidden tests/multiple windows do not depend on global focus.
      sendOpenFeatureTour(targetWindow instanceof BrowserWindow ? targetWindow : null)
    },
    // Zoom the focused popout rather than changing the native window behind it.
    onZoomIn: () => zoomFocusedWindowFromMenu('in'),
    onZoomOut: () => zoomFocusedWindowFromMenu('out'),
    onZoomReset: () => zoomFocusedWindowFromMenu('reset'),
    onToggleLeftSidebar: () => sendToFocusedDesktopRenderer('ui:toggleLeftSidebar'),
    onToggleRightSidebar: () => sendToFocusedDesktopRenderer('ui:toggleRightSidebar'),
    onToggleAppearance: (key) => {
      if (key === 'statusBarVisible') {
        // Renderer owns this persisted UI-state toggle; forward it rather than write settings.
        sendToFocusedDesktopRenderer('ui:toggleStatusBar')
        return
      }
      const current = store.getSettings()
      // Missing default-on values must toggle from visible to hidden.
      const next = getNextDefaultOnAppearanceSettingValue(current[key])
      store.updateSettings({ [key]: next }, { notifyListeners: true })
      rebuildAppMenu()
    },
    getAppearanceState: () => {
      const settings = store.getSettings()
      const ui = store.getUI()
      return {
        showTasksButton: settings.showTasksButton !== false,
        showAutomationsButton: settings.showAutomationsButton !== false,
        showMobileButton: settings.showMobileButton !== false,
        showTitlebarAppName: settings.showTitlebarAppName !== false,
        statusBarVisible: ui.statusBarVisible !== false
      }
    },
    getKeybindings: () => state.core.keybindings?.getOverrides()
  })
}
