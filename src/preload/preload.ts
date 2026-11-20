import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC_CHANNELS } from '../shared/constants';
import type { Config, AppearanceMode, WindowState, ServiceAccelerator, MenuActionId } from '../shared/types';

export interface PuppyApi {
  config: {
    get: () => Promise<Config>;
    set: (config: Config) => void;
    onChange: (callback: (config: Config) => void) => () => void;
  };
  shell: {
    spawn: (cwd?: string) => Promise<{ id: string; pid: number }>;
    onData: (callback: (data: { id: string; data: string }) => void) => () => void;
    onExit: (callback: (data: { id: string; exitCode?: number; signal?: number }) => void) => () => void;
    write: (id: string, data: string) => void;
    resize: (id: string, cols: number, rows: number) => void;
    kill: (id: string) => void;
    getCwd: (id: string) => Promise<string | undefined>;
    hasRunningScript: (id: string) => Promise<boolean>;
    isShellInForeground: (id: string) => Promise<boolean | undefined>;
  };
  clipboard: {
    writeText: (text: string) => void;
    readText: () => Promise<string>;
    /** Save the image currently on the clipboard and return its file path. */
    readImagePath: () => Promise<string | null>;
    /** Save raw image bytes to a temp file and return its file path. */
    saveImage: (data: Uint8Array, mimeType: string) => Promise<string | null>;
  };
  theme: {
    getSystem: () => Promise<AppearanceMode>;
    onSystemChange: (callback: (mode: AppearanceMode) => void) => () => void;
  };
  app: {
    openExternal: (url: string) => void;
  };
  services: {
    onRegistry: (callback: (entries: ServiceAccelerator[]) => void) => () => void;
    perform: (name: string, selection?: string) => void;
  };
  window: {
    saveState: (state: WindowState) => void;
    toggleMaximize: () => void;
    minimize: () => void;
    close: () => void;
    quit: () => void;
    setTitleBarColors: (color: string, symbolColor: string) => void;
  };
  menu: {
    onNewTab: (callback: () => void) => () => void;
    onCloseTab: (callback: () => void) => () => void;
    onPrevTab: (callback: () => void) => () => void;
    onNextTab: (callback: () => void) => () => void;
    onShowShortcuts: (callback: () => void) => () => void;
    onCopy: (callback: () => void) => () => void;
    onPaste: (callback: () => void) => () => void;
    perform: (action: MenuActionId) => Promise<void>;
  };
  webUtils: {
    getPathForFile: (file: File) => string;
  };
}

function onMenuChannel(channel: string, callback: () => void): () => void {
  const handler = () => callback();
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const api: PuppyApi = {
  config: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.CONFIG_GET),
    set: (config: Config) => ipcRenderer.send(IPC_CHANNELS.CONFIG_SET, config),
    onChange: (callback) => {
      const handler = (_event: unknown, config: Config) => callback(config);
      ipcRenderer.on(IPC_CHANNELS.CONFIG_CHANGED, handler);
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.CONFIG_CHANGED, handler);
      };
    },
  },
  shell: {
    spawn: (cwd?: string) => ipcRenderer.invoke(IPC_CHANNELS.SHELL_SPAWN, cwd),
    onData: (callback) => {
      const handler = (_event: unknown, data: { id: string; data: string }) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.SHELL_DATA, handler);
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.SHELL_DATA, handler);
      };
    },
    onExit: (callback) => {
      const handler = (_event: unknown, data: { id: string; exitCode?: number; signal?: number }) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.SHELL_EXIT, handler);
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.SHELL_EXIT, handler);
      };
    },
    write: (id: string, data: string) => ipcRenderer.send(IPC_CHANNELS.SHELL_INPUT, id, data),
    resize: (id: string, cols: number, rows: number) => {
      ipcRenderer.send(IPC_CHANNELS.SHELL_RESIZE, id, cols, rows);
    },
    kill: (id: string) => {
      ipcRenderer.send(IPC_CHANNELS.SHELL_KILL, id);
    },
    getCwd: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.SHELL_CWD, id),
    hasRunningScript: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.SHELL_HAS_RUNNING_SCRIPT, id),
    isShellInForeground: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.SHELL_IS_SHELL_FOREGROUND, id),
  },
  clipboard: {
    writeText: (text: string) => ipcRenderer.send(IPC_CHANNELS.CLIPBOARD_WRITE, text),
    readText: () => ipcRenderer.invoke(IPC_CHANNELS.CLIPBOARD_READ),
    readImagePath: () => ipcRenderer.invoke(IPC_CHANNELS.CLIPBOARD_READ_IMAGE_PATH),
    saveImage: (data: Uint8Array, mimeType: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.CLIPBOARD_SAVE_IMAGE, data, mimeType),
  },
  theme: {
    getSystem: () => ipcRenderer.invoke(IPC_CHANNELS.THEME_GET_SYSTEM),
    onSystemChange: (callback) => {
      const handler = (_event: unknown, mode: AppearanceMode) => callback(mode);
      ipcRenderer.on(IPC_CHANNELS.THEME_SYSTEM_CHANGED, handler);
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.THEME_SYSTEM_CHANGED, handler);
      };
    },
  },
  app: {
    openExternal: (url: string) => ipcRenderer.send(IPC_CHANNELS.APP_OPEN_EXTERNAL, url),
  },
  services: {
    onRegistry: (callback) => {
      const handler = (_event: unknown, entries: ServiceAccelerator[]) => callback(entries);
      ipcRenderer.on(IPC_CHANNELS.SERVICES_REGISTRY, handler);
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.SERVICES_REGISTRY, handler);
      };
    },
    perform: (name: string, selection?: string) =>
      ipcRenderer.send(IPC_CHANNELS.SERVICES_PERFORM, name, selection),
  },
  window: {
    saveState: (state: WindowState) => ipcRenderer.send(IPC_CHANNELS.WINDOW_STATE, state),
    toggleMaximize: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_TOGGLE_MAXIMIZE),
    minimize: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_MINIMIZE),
    close: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_CLOSE),
    quit: () => ipcRenderer.send(IPC_CHANNELS.APP_QUIT),
    setTitleBarColors: (color: string, symbolColor: string) =>
      ipcRenderer.send(IPC_CHANNELS.WINDOW_SET_TITLEBAR, { color, symbolColor }),
  },
  menu: {
    onNewTab: (callback) => {
      const handler = () => callback();
      ipcRenderer.on('menu:newTab', handler);
      return () => {
        ipcRenderer.removeListener('menu:newTab', handler);
      };
    },
    onCloseTab: (callback) => {
      const handler = () => callback();
      ipcRenderer.on('menu:closeTab', handler);
      return () => {
        ipcRenderer.removeListener('menu:closeTab', handler);
      };
    },
    onPrevTab: (callback) => {
      const handler = () => callback();
      ipcRenderer.on('menu:prevTab', handler);
      return () => {
        ipcRenderer.removeListener('menu:prevTab', handler);
      };
    },
    onNextTab: (callback) => {
      const handler = () => callback();
      ipcRenderer.on('menu:nextTab', handler);
      return () => {
        ipcRenderer.removeListener('menu:nextTab', handler);
      };
    },
    onShowShortcuts: (callback) => {
      const handler = () => callback();
      ipcRenderer.on('menu:showShortcuts', handler);
      return () => {
        ipcRenderer.removeListener('menu:showShortcuts', handler);
      };
    },
    onCopy: (callback) => onMenuChannel(IPC_CHANNELS.MENU_COPY, callback),
    onPaste: (callback) => onMenuChannel(IPC_CHANNELS.MENU_PASTE, callback),
    perform: (action: MenuActionId) => ipcRenderer.invoke(IPC_CHANNELS.MENU_ACTION, action),
  },
  webUtils: {
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
  },
};

contextBridge.exposeInMainWorld('puppy', api);

declare global {
  interface Window {
    puppy: PuppyApi;
  }
}
