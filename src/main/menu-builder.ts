import { app, Menu, MenuItemConstructorOptions, BrowserWindow, ipcMain } from 'electron';
import { IPC_CHANNELS } from '../shared/constants';

export function buildMenu(onNewWindow?: () => void): Menu {
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        // Native AppKit Services menu: AppKit populates it from the pbs
        // registry and validates items against the responder chain, same as
        // any macOS app (menu clicks dispatch through macOS itself).
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'New Tab',
          accelerator: 'CmdOrCtrl+T',
          click: (_item, focusedWindow) => {
            if (focusedWindow) {
              focusedWindow.webContents.send('menu:newTab');
            }
          },
        },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: (_item, focusedWindow) => {
            if (focusedWindow) {
              focusedWindow.webContents.send('menu:closeTab');
            }
          },
        },
        { type: 'separator' },
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            onNewWindow?.();
          },
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
          click: (_item, focusedWindow) => {
            if (focusedWindow) {
              focusedWindow.webContents.send('menu:showShortcuts');
            }
          },
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
      // Marks this submenu as the app-wide macOS windows menu, so AppKit
      // appends (and maintains) the list of open windows with a checkmark
      // on the focused one.
      role: 'window',
      submenu: [
        {
          label: 'Select Previous Tab',
          accelerator: 'CmdOrCtrl+Shift+[',
          click: (_item, focusedWindow) => {
            if (focusedWindow) {
              focusedWindow.webContents.send('menu:prevTab');
            }
          },
        },
        {
          label: 'Select Next Tab',
          accelerator: 'CmdOrCtrl+Shift+]',
          click: (_item, focusedWindow) => {
            if (focusedWindow) {
              focusedWindow.webContents.send('menu:nextTab');
            }
          },
        },
        { type: 'separator' },
        {
          label: 'Zoom Window',
          accelerator: 'CmdOrCtrl+Alt+Z',
          click: (_item, focusedWindow) => {
            if (focusedWindow) {
              if (focusedWindow.isMaximized()) {
                focusedWindow.unmaximize();
              } else {
                focusedWindow.maximize();
              }
            }
          },
        },
        { type: 'separator' },
        { role: 'minimize' },
        { role: 'close' },
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}

export function setApplicationMenu(onNewWindow?: () => void): void {
  const menu = buildMenu(onNewWindow);
  Menu.setApplicationMenu(menu);
}
