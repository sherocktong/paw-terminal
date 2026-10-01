import { app, BrowserWindow } from 'electron';
import path from 'path';
import { createWindow } from './window-manager';
import { registerIpcHandlers, registerThemeChangeHandler } from './ipc-handlers';
import { setApplicationMenu } from './menu-builder';
import { loadConfig, saveConfig } from './config-manager';
import { initServicesBridge } from './services-bridge';

const windows = new Set<BrowserWindow>();

function getLoadUrl(): string {
  if (process.env.VITE_DEV_SERVER_URL) {
    return process.env.VITE_DEV_SERVER_URL;
  }
  return path.join(__dirname, '../renderer/index.html');
}

async function createAppWindow(): Promise<void> {
  const config = loadConfig();
  const win = createWindow(config);
  windows.add(win);

  const loadUrl = getLoadUrl();
  if (loadUrl.startsWith('http')) {
    await win.loadURL(loadUrl);
  } else {
    await win.loadFile(loadUrl);
  }

  // Save window bounds on close so the next launch restores them
  win.on('close', () => {
    const config = loadConfig();
    const bounds = win.getNormalBounds();
    config.window = {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      maximized: win.isMaximized(),
    };
    saveConfig(config);
  });

  win.on('closed', () => {
    windows.delete(win);
  });
}

app.whenReady().then(() => {
  app.setAboutPanelOptions({
    applicationName: app.name,
    applicationVersion: app.getVersion(),
  });
  // IPC handlers are registered once and resolve the target window from
  // the event sender, so every window shares the same handlers.
  registerIpcHandlers();
  registerThemeChangeHandler();
  setApplicationMenu(() => {
    createAppWindow();
  });
  initServicesBridge();
  createAppWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createAppWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
