import { app, Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import { IPC_CHANNELS } from '../shared/constants';
import type { MenuActionId } from '../shared/types';

let onNewWindowCallback: () => void = () => {};

/**
 * Dispatches an application menu action to the given webContents.
 * This is the single entry point used by both menu item clicks and the
 * renderer keyboard shortcut handler (see src/renderer/app-shortcuts.ts).
 */
export function performMenuAction(action: MenuActionId, sender: Electron.WebContents | null): void {
  switch (action) {
    case 'newTab':
      sender?.send(IPC_CHANNELS.MENU_NEW_TAB);
      break;
    case 'closeTab':
      sender?.send(IPC_CHANNELS.MENU_CLOSE_TAB);
      break;
    case 'showShortcuts':
      sender?.send(IPC_CHANNELS.MENU_SHOW_SHORTCUTS);
      break;
    case 'prevTab':
      sender?.send(IPC_CHANNELS.MENU_PREV_TAB);
      break;
    case 'nextTab':
      sender?.send(IPC_CHANNELS.MENU_NEXT_TAB);
      break;
    case 'newWindow':
      onNewWindowCallback();
      break;
    case 'zoomWindow':
      sender?.send(IPC_CHANNELS.MENU_ZOOM);
      break;
  }
}

export function setApplicationMenu(onNewWindow: () => void): void {
  onNewWindowCallback = onNewWindow;

  const isMac = process.platform === 'darwin';
  const actionClick =
    (action: MenuActionId) =>
    (_item: Electron.MenuItem, focusedWindow: Electron.BaseWindow | undefined): void => {
      const webContents = (focusedWindow as Electron.BrowserWindow | undefined)?.webContents;
      performMenuAction(action, webContents ?? null);
    };

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            role: 'appMenu' as const,
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Tab',
          accelerator: 'CmdOrCtrl+T',
          click: actionClick('newTab'),
        },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: actionClick('closeTab'),
        },
        { type: 'separator' },
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+N',
          click: actionClick('newWindow'),
        },
        {
          label: 'Close Window',
          accelerator: 'CmdOrCtrl+Shift+W',
          role: 'close',
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        {
          label: 'Show Keyboard Shortcuts',
          accelerator: 'CmdOrCtrl+/',
          click: actionClick('showShortcuts'),
        },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      role: 'window',
      submenu: [
        {
          label: 'Select Previous Tab',
          accelerator: 'CmdOrCtrl+Shift+[',
          click: actionClick('prevTab'),
        },
        {
          label: 'Select Next Tab',
          accelerator: 'CmdOrCtrl+Shift+]',
          click: actionClick('nextTab'),
        },
        { type: 'separator' },
        {
          label: 'Zoom Window',
          accelerator: 'CmdOrCtrl+Alt+Z',
          click: actionClick('zoomWindow'),
        },
        { type: 'separator' },
        { role: 'minimize' },
        { role: 'close' },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
