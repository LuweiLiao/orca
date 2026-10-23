import { app } from 'electron'

/** Whether this build may check for, download, or install releases. */
export function isUpdaterActive(): boolean {
  // Why: an official release would replace this build and drop its multi-window windows.
  // oxlint-disable-next-line unicorn/no-typeof-undefined -- undeclared outside electron-vite builds; a bare read throws.
  const disabled = typeof ORCA_AUTO_UPDATE_DISABLED !== 'undefined' && ORCA_AUTO_UPDATE_DISABLED
  return app.isPackaged && !disabled
}
