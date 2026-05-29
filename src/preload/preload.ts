import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/constants';
import type { Config, AppearanceMode, WindowState } from '../shared/types';

export interface PuppyApi {
  config: {
    get: () => Promise<Config>;
    set: (config: Config) => void;
    onChange: (callback: (config: Config) => void) => () => void;
  };
  shell: {
    spawn: (cwd?: string) => Promise<{ id: string; pid: number }>;
    onData: (callback: (data: { id: string; data: string }) => void) => () => void;
    write: (id: string, data: string) => void;
    resize: (id: string, cols: number, rows: number) => void;
    kill: (id: string) => void;
    getCwd: (id: string) => Promise<string | undefined>;
  };
  clipboard: {
    writeText: (text: string) => void;
  };
  theme: {
    getSystem: () => Promise<AppearanceMode>;
    onSystemChange: (callback: (mode: AppearanceMode) => void) => () => void;
  };
  window: {
    saveState: (state: WindowState) => void;
    toggleMaximize: () => void;
  };
  menu: {
    onNewTab: (callback: () => void) => () => void;
    onCloseTab: (callback: () => void) => () => void;
    onPrevTab: (callback: () => void) => () => void;
    onNextTab: (callback: () => void) => () => void;
    onShowShortcuts: (callback: () => void) => () => void;
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
    spawn: (cwd?: string) => new Promise((resolve) => {
      const result = ipcRenderer.sendSync(IPC_CHANNELS.SHELL_SPAWN, cwd);
      resolve(result);
    }),
    onData: (callback) => {
      const handler = (_event: unknown, data: { id: string; data: string }) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.SHELL_DATA, handler);
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.SHELL_DATA, handler);
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
  },
  clipboard: {
    writeText: (text: string) => ipcRenderer.send(IPC_CHANNELS.CLIPBOARD_WRITE, text),
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
  window: {
    saveState: (state: WindowState) => ipcRenderer.send(IPC_CHANNELS.WINDOW_STATE, state),
    toggleMaximize: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_TOGGLE_MAXIMIZE),
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
  },
};

contextBridge.exposeInMainWorld('puppy', api);

declare global {
  interface Window {
    puppy: PuppyApi;
  }
}
