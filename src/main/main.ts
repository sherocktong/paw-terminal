import { app, BrowserWindow } from 'electron';
import path from 'path';
import { createWindow } from './window-manager';
import { registerIpcHandlers } from './ipc-handlers';
import { setApplicationMenu } from './menu-builder';
import { loadConfig } from './config-manager';

let mainWindow: BrowserWindow | null = null;

function getLoadUrl(): string {
  if (process.env.VITE_DEV_SERVER_URL) {
    return process.env.VITE_DEV_SERVER_URL;
  }
  return path.join(__dirname, '../renderer/index.html');
}

async function createMainWindow(): Promise<void> {
  const config = loadConfig();
  mainWindow = createWindow(config);

  registerIpcHandlers(mainWindow);

  const loadUrl = getLoadUrl();
  if (loadUrl.startsWith('http')) {
    await mainWindow.loadURL(loadUrl);
  } else {
    await mainWindow.loadFile(loadUrl);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  setApplicationMenu();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
