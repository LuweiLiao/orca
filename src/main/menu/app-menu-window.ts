export function createAppWindowMenu(
  label: string,
  isMac: boolean,
  leadingItems: Electron.MenuItemConstructorOptions[] = []
): Electron.MenuItemConstructorOptions {
  return {
    label,
    submenu: [
      ...leadingItems,
      {
        // Why: Electron's minimize role otherwise steals Ctrl+M from terminal apps such as Crush.
        role: 'minimize',
        ...(isMac ? {} : { accelerator: '', registerAccelerator: false })
      },
      { role: 'zoom' }
    ]
  }
}
