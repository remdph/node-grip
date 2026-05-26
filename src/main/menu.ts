import {
  app,
  BrowserWindow,
  Menu,
  type MenuItemConstructorOptions,
} from 'electron';

import { IPC_CHANNELS } from '~shared/types/ipc.js';

/** Builds the macOS-style app menu (also shown on Win/Linux when the user
 * presses Alt). File → Open Project pushes a message to the renderer so
 * the React HomeView can drive the same project picker the in-app
 * button uses (keeps the UX single-sourced). */
export function buildApplicationMenu(): Menu {
  const isMac = process.platform === 'darwin';

  const focusedWindow = () =>
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              {
                // Routes to the same React AboutDialog as the in-app
                // about button so the user gets clickable links/styled
                // copy instead of the native plain-text panel.
                label: `About ${app.name}`,
                click: () => {
                  focusedWindow()?.webContents.send(IPC_CHANNELS.app.showAbout);
                },
              },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Project…',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            focusedWindow()?.webContents.send(IPC_CHANNELS.app.openProject);
          },
        },
        { type: 'separator' },
        isMac
          ? ({ role: 'close' } satisfies MenuItemConstructorOptions)
          : ({ role: 'quit' } satisfies MenuItemConstructorOptions),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        ...(isMac
          ? [{ role: 'front' as const } satisfies MenuItemConstructorOptions]
          : [{ role: 'close' as const } satisfies MenuItemConstructorOptions]),
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}
