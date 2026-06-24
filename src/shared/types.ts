export interface Theme {
  id: string;
  name: string;
  type: 'dark' | 'light';
  colors: {
    background: string;
    foreground: string;
    cursor: string;
    cursorAccent: string;
    selectionBackground: string;
    selectionForeground?: string;
    black: string;
    red: string;
    green: string;
    yellow: string;
    blue: string;
    magenta: string;
    cyan: string;
    white: string;
    brightBlack: string;
    brightRed: string;
    brightGreen: string;
    brightYellow: string;
    brightBlue: string;
    brightMagenta: string;
    brightCyan: string;
    brightWhite: string;
  };
  font?: {
    family?: string;
    size?: number;
    lineHeight?: number;
  };
  opacity?: number;
}

export interface Keybinding {
  key: string;
  modifiers?: ('ctrl' | 'shift' | 'alt' | 'meta')[];
  command: string;
}

export interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized?: boolean;
}

export interface Config {
  lightTheme: string;
  darkTheme: string;
  scrollback: number;
  font: {
    family: string;
    size: number;
    lineHeight: number;
  };
  opacity: number;
  cursorStyle: 'block' | 'bar' | 'underline';
  cursorBlink: boolean;
  copyMode: {
    enterKey: string;
    enterModifiers: ('ctrl' | 'shift' | 'alt' | 'meta')[];
    macModifiers?: ('ctrl' | 'shift' | 'alt' | 'meta')[];
    winModifiers?: ('ctrl' | 'shift' | 'alt' | 'meta')[];
  };
  window: WindowState;
  shell?: string;
  shellArgs?: string[];
  customThemes: Theme[];
}

export type AppearanceMode = 'dark' | 'light';

export interface CopyModePosition {
  line: number;
  col: number;
}

export type CopyModeSubMode = 'normal' | 'visual' | 'visualLine';

export interface CopyModeState {
  active: boolean;
  subMode: CopyModeSubMode;
  cursor: CopyModePosition;
  anchor?: CopyModePosition;
  searchQuery: string;
  searchDirection: 'forward' | 'backward';
  searchResults: CopyModePosition[];
  currentSearchIndex: number;
  bufferLines: string[];
}

export interface IpcChannels {
  'config:get': () => Config;
  'config:set': (config: Config) => void;
  'config:changed': (config: Config) => void;
  'shell:spawn': () => { pid: number };
  'shell:data': (data: { id: string; data: string }) => void;
  'shell:resize': (cols: number, rows: number) => void;
  'shell:input': (data: string) => void;
  'shell:kill': () => void;
  'shell:exit': () => { id: string; exitCode?: number; signal?: number };
  'shell:cwd': () => string | undefined;
  'clipboard:write': (text: string) => void;
  'theme:getSystem': () => AppearanceMode;
  'theme:systemChanged': (mode: AppearanceMode) => void;
  'window:state': (state: WindowState) => void;
  'window:toggleMaximize': () => void;
}
