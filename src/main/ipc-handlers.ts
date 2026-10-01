import { ipcMain, clipboard, nativeTheme, BrowserWindow, app, shell } from 'electron';
import crypto from 'crypto';
import { IPC_CHANNELS } from '../shared/constants';
import { loadConfig, saveConfig } from './config-manager';
import { spawnShell, getShellCwd, hasRunningScript, isShellInForeground } from './shell-manager';
import type { Config } from '../shared/types';
import type { IPty } from 'node-pty';

const ptyMap = new Map<string, IPty>();

export function registerIpcHandlers(): void {
  // Open links in the system default browser (only safe schemes)
  ipcMain.on(IPC_CHANNELS.APP_OPEN_EXTERNAL, (_event, url: string) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
  });

  // Config
  ipcMain.handle(IPC_CHANNELS.CONFIG_GET, (): Config => {
    return loadConfig();
  });

  ipcMain.on(IPC_CHANNELS.CONFIG_SET, (_event, config: Config) => {
    saveConfig(config);
  });

  // Shell / PTY
  ipcMain.handle(IPC_CHANNELS.SHELL_SPAWN, (event, cwd?: string) => {
    const config = loadConfig();
    const cols = 80;
    const rows = 30;
    const ptyProcess = spawnShell(config.shell, config.shellArgs, cwd, cols, rows);
    const id = crypto.randomUUID();
    ptyMap.set(id, ptyProcess);

    // Route output back to the window that spawned the shell
    const sender = event.sender;

    ptyProcess.onData((data) => {
      if (!sender.isDestroyed()) {
        sender.send(IPC_CHANNELS.SHELL_DATA, { id, data });
      }
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
      ptyMap.delete(id);
      if (!sender.isDestroyed()) {
        sender.send(IPC_CHANNELS.SHELL_EXIT, { id, exitCode, signal });
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
      const config = loadConfig();
      return hasRunningScript(ptyProcess.pid, config.interactiveConsoleNames);
    }
    return false;
  });

  // Returns true when the shell owns the TTY foreground (no foreground
  // child process such as a TUI app), false when a foreground app owns
  // the terminal, or undefined when it cannot be determined.
  ipcMain.handle(IPC_CHANNELS.SHELL_IS_SHELL_FOREGROUND, async (_event, id: string): Promise<boolean | undefined> => {
    const ptyProcess = ptyMap.get(id);
    if (ptyProcess) {
      return isShellInForeground(ptyProcess.pid);
    }
    return undefined;
  });

  // Clipboard
  ipcMain.on(IPC_CHANNELS.CLIPBOARD_WRITE, (_event, text: string) => {
    clipboard.writeText(text);
  });

  // Theme
  ipcMain.handle(IPC_CHANNELS.THEME_GET_SYSTEM, () => {
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  });

  // Window toggle maximize
  ipcMain.on(IPC_CHANNELS.WINDOW_TOGGLE_MAXIMIZE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  });

  // Minimize window
  ipcMain.on(IPC_CHANNELS.WINDOW_MINIMIZE, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  // Close the window that sent the request (used when the last tab closes)
  ipcMain.on(IPC_CHANNELS.WINDOW_CLOSE, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  // Quit app
  ipcMain.on(IPC_CHANNELS.APP_QUIT, () => {
    app.quit();
  });
}

// Registered once at startup — not per-window — so theme changes fan out
// to every window without duplicate listeners.
export function registerThemeChangeHandler(): void {
  nativeTheme.on('updated', () => {
    const mode = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send(IPC_CHANNELS.THEME_SYSTEM_CHANGED, mode);
    });
  });
}
