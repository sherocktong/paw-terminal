import { app, Menu, MenuItemConstructorOptions, BrowserWindow, ipcMain } from 'electron';
import { IPC_CHANNELS } from '../shared/constants';

export function buildMenu(): Menu {
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
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
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => {
            // TODO: implement multi-window support
          },
        },
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

export function setApplicationMenu(): void {
  const menu = buildMenu();
  Menu.setApplicationMenu(menu);
}
