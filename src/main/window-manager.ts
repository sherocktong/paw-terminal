import { BrowserWindow, nativeTheme } from 'electron';
import path from 'path';
import { BUILTIN_THEMES } from '../shared/constants';
import type { Config, AppearanceMode, WindowState } from '../shared/types';

function getInitialBackgroundColor(config: Config): string {
  const isDark = nativeTheme.shouldUseDarkColors;
  const themeId = isDark ? config.darkTheme : config.lightTheme;

  const custom = config.customThemes.find((t) => t.id === themeId);
  if (custom) return custom.colors.background;

  const builtin = BUILTIN_THEMES.find((t) => t.id === themeId);
  if (builtin) return builtin.colors.background;

  return isDark ? '#282a36' : '#e5e5e5';
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
    hasShadow: false,
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

export function applyAppearance(win: BrowserWindow, mode: AppearanceMode, config: Config): void {
  const themeId = mode === 'dark' ? config.darkTheme : config.lightTheme;

  const custom = config.customThemes.find((t) => t.id === themeId);
  if (custom) {
    win.setBackgroundColor(custom.colors.background);
    return;
  }

  const builtin = BUILTIN_THEMES.find((t) => t.id === themeId);
  if (builtin) {
    win.setBackgroundColor(builtin.colors.background);
    return;
  }

  win.setBackgroundColor(mode === 'dark' ? '#282a36' : '#e5e5e5');
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
