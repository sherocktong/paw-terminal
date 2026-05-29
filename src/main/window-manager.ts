import { BrowserWindow, nativeTheme } from 'electron';
import path from 'path';
import type { Config, AppearanceMode, WindowState } from '../shared/types';

function getInitialBackgroundColor(config: Config): string {
  const isDark = nativeTheme.shouldUseDarkColors;
  if (config.theme === 'auto' || config.theme === 'system') {
    return isDark ? '#282a36' : '#fdf6e3';
  }
  return isDark ? '#282a36' : '#fdf6e3';
}

const isMac = process.platform === 'darwin';

export function createWindow(config: Config): BrowserWindow {
  const winState = config.window;

  const win = new BrowserWindow({
    width: winState.width,
    height: winState.height,
    x: winState.x,
    y: winState.y,
    title: 'Paw',
    backgroundColor: getInitialBackgroundColor(config),
    titleBarStyle: isMac ? 'hidden' : undefined,
    frame: !isMac,
    trafficLightPosition: isMac ? { x: 16, y: 10 } : undefined,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (winState.maximized) {
    win.maximize();
  }

  win.once('ready-to-show', () => {
    win.show();
    if (winState.maximized) {
      win.maximize();
    }
  });

  return win;
}

export function applyAppearance(win: BrowserWindow, mode: AppearanceMode): void {
  const bg = mode === 'dark' ? '#282a36' : '#fdf6e3';
  win.setBackgroundColor(bg);
}

export function getCurrentWindowState(win: BrowserWindow): WindowState {
  const bounds = win.getNormalBounds();
  return {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    maximized: win.isMaximized(),
  };
}
