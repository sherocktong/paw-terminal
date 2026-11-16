import { BrowserWindow, nativeTheme } from 'electron';
import path from 'path';
import { BUILTIN_THEMES } from '../shared/constants';
import { computeTabColors } from '../shared/tab-colors';
import type { Config, AppearanceMode, WindowState, Theme } from '../shared/types';

const isMac = process.platform === 'darwin';
const isWindows = process.platform === 'win32';

/** Height of the tab strip, which doubles as the custom title bar. */
export const TITLE_BAR_HEIGHT = 32;

function resolveTheme(config: Config, isDark: boolean): Theme | undefined {
  const themeId = isDark ? config.darkTheme : config.lightTheme;
  const builtin = BUILTIN_THEMES.find((t) => t.id === themeId) as Theme | undefined;
  return config.customThemes.find((t) => t.id === themeId) ?? builtin;
}

function getInitialBackgroundColor(config: Config): string {
  const isDark = nativeTheme.shouldUseDarkColors;
  const theme = resolveTheme(config, isDark);
  if (theme) return theme.colors.background;
  return isDark ? '#282a36' : '#e5e5e5';
}

function getWindowChromeColor(config: Config): string {
  const theme = resolveTheme(config, nativeTheme.shouldUseDarkColors);
  if (!theme) return nativeTheme.shouldUseDarkColors ? '#2e2e2e' : '#e8e8e8';
  return computeTabColors(theme).barBg;
}

export function createWindow(config: Config): BrowserWindow {
  const winState = config.window;
  const theme = resolveTheme(config, nativeTheme.shouldUseDarkColors);
  const tabColors = theme ? computeTabColors(theme) : null;

  const win = new BrowserWindow({
    width: winState.width,
    height: winState.height,
    x: winState.x,
    y: winState.y,
    title: 'Paw',
    backgroundColor: getInitialBackgroundColor(config),
    // On Windows/macOS the tab strip doubles as the title bar. Windows keeps
    // native window controls via the title bar overlay.
    titleBarStyle: isMac || isWindows ? 'hidden' : undefined,
    titleBarOverlay: isWindows
      ? {
          color: tabColors?.barBg ?? getWindowChromeColor(config),
          symbolColor: tabColors?.symbolColor ?? '#ffffff',
          height: TITLE_BAR_HEIGHT,
        }
      : undefined,
    frame: isMac ? false : undefined,
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
  const theme = resolveTheme(config, mode === 'dark');

  win.setBackgroundColor(theme?.colors.background ?? (mode === 'dark' ? '#282a36' : '#e5e5e5'));

  if (isWindows && theme) {
    const tabColors = computeTabColors(theme);
    win.setTitleBarOverlay({
      color: tabColors.barBg,
      symbolColor: tabColors.symbolColor,
      height: TITLE_BAR_HEIGHT,
    });
  }
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
