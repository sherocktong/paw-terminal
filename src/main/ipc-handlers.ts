import { ipcMain, clipboard, nativeTheme, BrowserWindow, app } from 'electron';
import crypto from 'crypto';
import { IPC_CHANNELS } from '../shared/constants';
import { loadConfig, saveConfig } from './config-manager';
import { spawnShell, getShellCwd, hasRunningScript } from './shell-manager';
import type { Config } from '../shared/types';
import type { IPty } from 'node-pty';

const ptyMap = new Map<string, IPty>();

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  // Config
  ipcMain.handle(IPC_CHANNELS.CONFIG_GET, (): Config => {
    return loadConfig();
  });

  ipcMain.on(IPC_CHANNELS.CONFIG_SET, (_event, config: Config) => {
    saveConfig(config);
  });

  // Shell / PTY
  ipcMain.handle(IPC_CHANNELS.SHELL_SPAWN, (_event, cwd?: string) => {
    const config = loadConfig();
    const cols = 80;
    const rows = 30;
    const ptyProcess = spawnShell(config.shell, config.shellArgs, cwd, cols, rows);
    const id = crypto.randomUUID();
    ptyMap.set(id, ptyProcess);

    ptyProcess.onData((data) => {
      // Use webContents to send data to renderer
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.SHELL_DATA, { id, data });
      }
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
      ptyMap.delete(id);
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.SHELL_EXIT, { id, exitCode, signal });
      }
    });

    return { id, pid: ptyProcess.pid };
  });

  ipcMain.on(IPC_CHANNELS.SHELL_INPUT, (_event, id: string, data: string) => {
    const ptyProcess = ptyMap.get(id);
    if (ptyProcess) {
      ptyProcess.write(data);
    }
  });

  ipcMain.on(IPC_CHANNELS.SHELL_KILL, (_event, id: string) => {
    const ptyProcess = ptyMap.get(id);
    if (ptyProcess) {
      ptyProcess.kill();
      ptyMap.delete(id);
    }
  });

  ipcMain.on(IPC_CHANNELS.SHELL_RESIZE, (_event, id: string, cols: number, rows: number) => {
    const ptyProcess = ptyMap.get(id);
    if (ptyProcess) {
      ptyProcess.resize(cols, rows);
    }
  });

  ipcMain.handle(IPC_CHANNELS.SHELL_CWD, (_event, id: string): string | undefined => {
    const ptyProcess = ptyMap.get(id);
    if (ptyProcess) {
      return getShellCwd(ptyProcess.pid);
    }
    return undefined;
  });

  ipcMain.handle(IPC_CHANNELS.SHELL_HAS_RUNNING_SCRIPT, async (_event, id: string): Promise<boolean> => {
    const ptyProcess = ptyMap.get(id);
    if (ptyProcess) {
      return hasRunningScript(ptyProcess.pid);
    }
    return false;
  });

  // Clipboard
  ipcMain.on(IPC_CHANNELS.CLIPBOARD_WRITE, (_event, text: string) => {
    clipboard.writeText(text);
  });

  // Theme
  ipcMain.handle(IPC_CHANNELS.THEME_GET_SYSTEM, () => {
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  });

  nativeTheme.on('updated', () => {
    const mode = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send(IPC_CHANNELS.THEME_SYSTEM_CHANGED, mode);
    });
  });

  // Window toggle maximize
  ipcMain.on(IPC_CHANNELS.WINDOW_TOGGLE_MAXIMIZE, () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });

  // Minimize window
  ipcMain.on(IPC_CHANNELS.WINDOW_MINIMIZE, () => {
    mainWindow.minimize();
  });

  // Quit app
  ipcMain.on(IPC_CHANNELS.APP_QUIT, () => {
    app.quit();
  });

  // Window state save on close
  mainWindow.on('close', () => {
    const config = loadConfig();
    const bounds = mainWindow.getNormalBounds();
    config.window = {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      maximized: mainWindow.isMaximized(),
    };
    saveConfig(config);
  });
}
